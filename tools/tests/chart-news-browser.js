// Charts News panel + News markers + Economic events indicator (assets/chart-news.js,
// assets/chart-news-markers.js) against tools/tests/chart-dev-server.mjs.
// The recorder's /news and /cal are answered from fixtures (no live dependency); bars are live.
//   CHART_BASE=http://127.0.0.1:8071 flock /tmp/stryker-chrome.lock node --max-old-space-size=768 tools/tests/chart-news-browser.js <shotsDir>
// Checks:
//   1440: a News button sits in the right icon bar under the Watchlist; it opens the panel in the
//         Watchlist's slot (the chart narrows, opening the Watchlist closes News); the NQ tab asks
//         /news?sym=NQ; All markets asks sym=''; typing searches (q=); rows link out (target=_blank,
//         rel=noopener); the list scrolls with the shared thin scrollbar (no default bar).
//   replay: with window.__stkReplay on, the request carries to=<replay clock> and no headline after it renders.
//   390: the News button opens a full-screen sheet; no horizontal scroll; Escape closes.
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8071';
const OUT = process.argv[2] || '/tmp';
let fail = 0;
const check = (ok, msg, extra) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (extra !== undefined && !ok ? ' ' + JSON.stringify(extra).slice(0, 400) : '')); };

const NOW = Math.floor(Date.now() / 1000);
const FIX = [
  { id: 'a1', t: NOW - 120, s: 'Reuters', h: 'Nasdaq futures slide as hot inflation data lifts yields', m: 'US stock index futures fell after consumer prices rose more than expected.', u: 'https://example.com/a1', g: ['NQ', 'MACRO'] },
  { id: 'a2', t: NOW - 1500, s: 'Financial Juice', h: "Fed's Barkin: rates may need to stay higher for longer", g: ['MACRO'], m: 'Richmond Fed President Barkin said policy may need to stay restrictive while inflation runs above target, adding that the labor market remains solid.' },
  { id: 'a3', t: NOW - 4000, s: 'Dow Jones Newswires', h: 'Microsoft shares slip after cloud capacity warning', u: 'https://example.com/a3', g: ['NQ', 'ES', 'YM', 'STOCKS'] },
  { id: 'a4', t: NOW - 9000, s: 'Reuters', h: 'Gold slips as dollar firms ahead of retail sales', u: 'https://example.com/a4', g: ['GC'] },
  { id: 'a5', t: NOW - 20000, s: 'Cointelegraph', h: 'Bitcoin holds above key level as ETF flows turn positive', u: 'https://example.com/a5', g: ['BTC', 'CRYPTO'] }
];
for (let i = 0; i < 30; i++) FIX.push({ id: 'z' + i, t: NOW - 30000 - i * 3000, s: 'Reuters', h: 'Wall Street headline number ' + (i + 1) + ' for the scroll test', u: 'https://example.com/z' + i, g: ['ES', 'MACRO'] });
const reqs = [];

async function open(b, { w, h, mobile }) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, isMobile: !!mobile, hasTouch: !!mobile });
  await ctx.addInitScript(stub);
  await ctx.addInitScript(() => { try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); localStorage.removeItem('stknw_open'); } catch (e) {} });
  await ctx.route(/^https?:\/\/(?!localhost|127\.0\.0\.1|cdn\.jsdelivr\.net)/, (r) => r.abort());
  await ctx.route(/book-recorder\.theelitegrey\.workers\.dev\/news/, (r) => {
    const u = new URL(r.request().url());
    reqs.push(u.search);
    const sym = u.searchParams.get('sym'), q = (u.searchParams.get('q') || '').toLowerCase(), to = Number(u.searchParams.get('to')) || Infinity;
    const tags = { NQ: ['NQ', 'MACRO'], ES: ['ES', 'MACRO'], GC: ['GC', 'MACRO'], BTC: ['BTC', 'CRYPTO'] }[sym];
    const items = FIX.filter((x) => (!tags || x.g.some((g) => tags.includes(g))) && (!q || (x.h + ' ' + (x.m || '')).toLowerCase().includes(q)) && x.t <= to);
    r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ items, updated: NOW }) });
  });
  const p = await ctx.newPage();
  const errors = [];
  p.on('console', (m) => { if (m.type() === 'error' && !/ERR_FAILED|Failed to load resource|\/api\/chart\/stream/.test(m.text())) errors.push(m.text()); });
  p.on('pageerror', (e) => errors.push(String(e)));
  await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.STRYKER_VELA && window.__stkNews, null, { timeout: 45000 });
  await p.waitForTimeout(3500);
  return { ctx, p, errors };
}
async function setSym(p, s) {
  await p.evaluate((s) => { const ws = window.STRYKER_VELA.ws || window.STRYKER_VELA; (ws.active || ws.cell(ws.context().cells[0].id)).setSymbol ? ws.active.setSymbol(s) : ws.setSymbol(s); }, s).catch(() => {});
  await p.waitForTimeout(1500);
}

(async () => {
  const b = await launch({ args: ['--js-flags=--max-old-space-size=768'] });
  try {
    // ---------------- desktop 1440
    {
      const { ctx, p, errors } = await open(b, { w: 1440, h: 900 });
      const sym = await p.evaluate(() => { try { return window.STRYKER_VELA.ws.active.symbol; } catch (e) { try { return window.__stkNews && document.querySelector('.vela-widget-symbol').textContent; } catch (e2) { return ''; } } });
      console.log('active symbol:', sym);
      const rail = await p.evaluate(() => [...document.querySelectorAll('.stkw-rail button')].map((x) => x.getAttribute('aria-label')));
      check(rail[0] === 'Watchlist' && rail[1] === 'News', '1440: News button right under Watchlist in the right icon bar', rail);
      const w0 = await p.evaluate(() => document.getElementById('vela-chart').getBoundingClientRect().width);
      await p.click('.stknw-railbtn');
      await p.waitForSelector('.stknw-row', { timeout: 8000 });
      const st = await p.evaluate(() => {
        const pn = document.getElementById('stknw'), r = pn.getBoundingClientRect(), ch = document.getElementById('vela-chart').getBoundingClientRect();
        const rows = [...document.querySelectorAll('.stknw-row')];
        const a = rows.find((x) => x.tagName === 'A');
        const L = document.querySelector('.stknw-list');
        return { vis: !pn.hidden, w: Math.round(r.width), chartW: Math.round(ch.width), overlap: ch.right > r.left + 1, rows: rows.length, first: rows[0] && rows[0].querySelector('.stknw-h').textContent,
          tab: document.querySelector('.stknw-tab.on').textContent, target: a && a.target, rel: a && a.rel, href: a && a.href,
          scroll: L.scrollHeight > L.clientHeight, sbw: getComputedStyle(L, '::-webkit-scrollbar').width, pressed: document.querySelector('.stknw-railbtn').getAttribute('aria-pressed') };
      });
      check(st.vis && st.w >= 300 && !st.overlap && st.chartW < w0 - 250, '1440: panel opens beside the chart (chart narrows, no overlap)', st);
      check(/NQ/.test(st.tab) && reqs.some((q) => /sym=NQ/.test(q)), '1440: NQ tab asks /news?sym=NQ', { tab: st.tab, reqs });
      check(st.rows >= 3 && /Nasdaq futures slide/.test(st.first), '1440: headlines for NQ, newest first', st);
      check(st.target === '_blank' && /noopener/.test(st.rel) && /^https:\/\/example\.com\//.test(st.href), '1440: a row opens the source article in a new tab', st);
      check(st.scroll && st.sbw === '10px', '1440: list scrolls with the shared thin scrollbar', st);
      await p.screenshot({ path: OUT + '/news-1440-nq.png' });
      console.log('screenshot', OUT + '/news-1440-nq.png');
      await p.click('.stknw-tab[data-tab="all"]');
      await p.waitForTimeout(800);
      const all = await p.evaluate(() => ({ n: document.querySelectorAll('.stknw-row').length, txt: document.querySelector('.stknw-list').textContent }));
      check(reqs.some((q) => /sym=(&|$)/.test(q)) && /Bitcoin holds/.test(all.txt), '1440: All markets shows every market', all.n);
      await p.fill('.stknw-q', 'gold');
      await p.waitForTimeout(1200);
      const srch = await p.evaluate(() => [...document.querySelectorAll('.stknw-h')].map((x) => x.textContent));
      check(reqs.some((q) => /q=gold/.test(q)) && srch.length === 1 && /Gold slips/.test(srch[0]), '1440: search asks q= and filters', srch);
      await p.fill('.stknw-q', '');
      await p.waitForTimeout(900);
      // no-link row expands its summary
      const exp = await p.evaluate(() => { const r = document.querySelector('.stknw-row.is-nolink'); if (!r) return null; const m = r.querySelector('.stknw-m'); const h0 = m.getBoundingClientRect().height; r.click(); return { h0, h1: m.getBoundingClientRect().height, aria: r.getAttribute('aria-expanded') }; });
      check(exp && exp.h1 > exp.h0 && exp.aria === 'true', '1440: a row without a link expands its summary', exp);
      // replay cut-off
      const cut = (NOW - 3000) * 1000;
      await p.evaluate((cut) => { window.__stkReplayBackup = window.__stkReplay; window.__stkReplay = { on: true, now: () => cut, E: cut }; window.__stkNews.reload(); }, cut);
      await p.waitForTimeout(1200);
      const rp = await p.evaluate(() => ({ h: [...document.querySelectorAll('.stknw-h')].map((x) => x.textContent), note: document.querySelector('.stknw-note').textContent, hidden: document.querySelector('.stknw-note').hidden }));
      check(reqs.some((q) => new RegExp('to=' + Math.floor(cut / 1000)).test(q)), 'replay: request carries to=<replay clock>', reqs.slice(-2));
      check(!rp.h.some((h) => /Nasdaq futures slide|Barkin/.test(h)) && rp.h.some((h) => /Microsoft/.test(h)), 'replay: no headline after the replay clock', rp.h.slice(0, 4));
      check(!rp.hidden && /Bar replay/.test(rp.note), 'replay: panel says it is cut at the replay time', rp.note);
      await p.screenshot({ path: OUT + '/news-1440-replay.png' });
      console.log('screenshot', OUT + '/news-1440-replay.png');
      await p.evaluate(() => { window.__stkReplay = window.__stkReplayBackup; window.__stkNews.reload(); });
      // Watchlist shares the slot
      await p.click('.stkw-railbtn:not(.stknw-railbtn)');
      await p.waitForTimeout(500);
      const sw = await p.evaluate(() => ({ news: !document.getElementById('stknw').hidden, wl: !document.getElementById('stkw').hidden }));
      check(!sw.news && sw.wl, '1440: opening the Watchlist closes News (one slot)', sw);
      await p.click('.stknw-railbtn');
      await p.waitForTimeout(500);
      const sw2 = await p.evaluate(() => ({ news: !document.getElementById('stknw').hidden, wl: !document.getElementById('stkw').hidden }));
      check(sw2.news && !sw2.wl, '1440: opening News closes the Watchlist', sw2);
      check(errors.length === 0, '1440: no console errors', errors);
      await ctx.close();
    }
    // ---------------- phone 390
    {
      const { ctx, p, errors } = await open(b, { w: 390, h: 844, mobile: true });
      const btn = await p.evaluate(() => { const x = document.querySelector('.stknw-phonebtn'); return x ? { inMore: !!x.closest('#stkc-more-pop'), vis: x.getClientRects().length > 0 } : null; });
      check(!!btn, '390: News button exists on the chart bar (or in ⋯ More)', btn);
      if (btn && btn.inMore) { await p.click('#stkc-more-btn'); await p.waitForTimeout(300); }
      await p.click('.stknw-phonebtn');
      await p.waitForSelector('.stknw-row', { timeout: 8000 });
      const s = await p.evaluate(() => { const r = document.getElementById('stknw').getBoundingClientRect(); return { l: r.left, w: Math.round(r.width), h: Math.round(r.height), sw: document.documentElement.scrollWidth, rows: document.querySelectorAll('.stknw-row').length }; });
      check(s.l === 0 && s.w === 390 && s.h > 500 && s.sw <= 391, '390: full-screen sheet, no horizontal scroll', s);
      await p.screenshot({ path: OUT + '/news-390.png' });
      console.log('screenshot', OUT + '/news-390.png');
      await p.keyboard.press('Escape');
      await p.waitForTimeout(300);
      check(await p.evaluate(() => document.getElementById('stknw').hidden), '390: Escape closes the sheet');
      check(errors.length === 0, '390: no console errors', errors);
      await ctx.close();
    }
  } finally { await b.close(); }
  console.log(fail ? fail + ' FAILED' : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
