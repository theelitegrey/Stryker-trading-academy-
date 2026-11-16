// Read-only probe: what the recorder Worker returns for NQ book history / trades / aux over the last 30 h, in 6 h windows
// (live site, demo account, the page's own auth headers). Prints sizes and sample counts only.
//   flock /tmp/stryker-chrome.lock node tools/tests/hm-update-feed-probe.mjs
import dns from 'node:dns/promises';
import { createRequire } from 'node:module';
import { login, BASE } from '../demo-account/lib/browser.mjs';
const { chromium } = createRequire('/root/projects/stryker-trading-academy/package.json')('playwright-core');
const G = ['identitytoolkit.googleapis.com', 'securetoken.googleapis.com', 'firestore.googleapis.com', 'www.googleapis.com', 'firebaseinstallations.googleapis.com'];
const rules = (await Promise.all(G.map(async (h) => { try { return 'MAP ' + h + ' ' + (await dns.resolve4(h))[0]; } catch (e) { return ''; } }))).filter(Boolean).join(', ');
const b = await chromium.launch({ executablePath: '/root/.cache/ms-playwright/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox', '--disable-dev-shm-usage', '--host-resolver-rules=' + rules] });
const page = await (await b.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
try {
  await login(page);
  await page.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA, null, { timeout: 90000 });
  await new Promise((r) => setTimeout(r, 4000));
  for (const [sym, h, n, end] of JSON.parse(process.env.PROBES || '[["NQ",6,5,0]]')) {
  await page.evaluate(([a, b, c, d]) => { window.__probeSym = a; window.__probeH = b; window.__probeN = c; window.__probeEnd = d || 0; }, [sym, h, n, end]);
  const res = await page.evaluate(async () => {
    const v = (await (await fetch('/assets/version.json', { cache: 'no-store' })).json()).build;
    const rt = await import('/assets/rt-access.js?v=' + v), of = await import('/assets/chart-orderflow.js?v=' + v);
    await rt.rtReady(); const h = rt.rtHeaders();
    const base = 'https://book-recorder.theelitegrey.workers.dev', now = Date.now(), out = [];
    const SYM = window.__probeSym || 'NQ', H = window.__probeH || 6, N = window.__probeN || 5, END = window.__probeEnd || now;
    for (let k = 0; k < N; k++) {
      const to = END - k * H * 3600000, from = to - H * 3600000, row = { sym: SYM, win: new Date(from).toISOString().slice(5, 16) + '..' + new Date(to).toISOString().slice(11, 16) };
      try { const r = await fetch(base + '/ts-book-history?symbol=' + SYM + '&from=' + from + '&to=' + to, { headers: h }); const buf = await r.arrayBuffer(); const d = of.decodeBookHistory ? of.decodeBookHistory(buf) : null;
        row.book = r.status + ' ' + buf.byteLength + 'B left=' + r.headers.get('x-ts-fill-left') + ' samples=' + (d ? d.length : '?') + (d && d.length ? ' first=' + new Date(d[0].ts).toISOString().slice(11, 16) + ' last=' + new Date(d[d.length - 1].ts).toISOString().slice(5, 16) : ''); } catch (e) { row.book = 'ERR ' + e.message; }
      try { const r = await fetch(base + '/ts-trades?sym=' + SYM + '&from=' + from + '&to=' + to, { headers: h }); const j = await r.json(); row.trades = r.status + ' trades=' + (j.trades || []).length + ' delta=' + (j.delta || []).length + ' left=' + j.left + (j.trades && j.trades.length ? ' last=' + new Date(j.trades[j.trades.length - 1][0]).toISOString().slice(5, 16) : ''); } catch (e) { row.trades = 'ERR ' + e.message; }
      try { const r = await fetch(base + '/ts-aux?symbol=' + SYM + '&from=' + from + '&to=' + to, { headers: h }); const j = await r.json(); row.aux = r.status + ' fp=' + (j.fp || []).length + ' imb=' + (j.imb || []).length; } catch (e) { row.aux = 'ERR ' + e.message; }
      out.push(row);
    }
    return { decode: !!of.decodeBookHistory, out };
  });
  for (const r of res.out) console.log(JSON.stringify(r));
  }
} catch (e) { console.log('ERR', String(e.stack || e).slice(0, 400)); }
await b.close();
