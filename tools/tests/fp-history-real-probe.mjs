// REAL-feed probe for Harry's "Footprint not loading, I want historical data" (12 Nov): logs in as the demo Pro account on the live site,
// borrows the page's own recorder token (kept in memory, never printed) and asks the book-recorder Worker directly how far back each
// footprint source goes: /ts-aux (per-price minutes the hub recorded, what the footprint used to read) and /ts-trades (the 48 h L1 trade
// store with archive backfill), for NQ, MNQ, ES, MES. Prints coverage per 6 h window.
//   flock /tmp/stryker-chrome.lock node tools/tests/fp-history-real-probe.mjs
import { login, BASE } from '../demo-account/lib/browser.mjs';
import { createRequire } from 'node:module';
const { chromium } = createRequire('/root/projects/stryker-trading-academy/package.json')('playwright-core');
import dns from 'node:dns/promises';
const REC = 'https://book-recorder.theelitegrey.workers.dev';
const G = ['identitytoolkit.googleapis.com', 'securetoken.googleapis.com', 'firestore.googleapis.com', 'www.googleapis.com'];
const rules = (await Promise.all(G.map(async (h) => { try { return 'MAP ' + h + ' ' + (await dns.resolve4(h))[0]; } catch (e) { return ''; } }))).filter(Boolean).join(', ');   // this server's IPv6 gets 403 from Google sign-in
const b = await chromium.launch({ executablePath: '/root/.cache/ms-playwright/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox', '--disable-dev-shm-usage', '--js-flags=--max-old-space-size=768', '--host-resolver-rules=' + rules] });
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } }), page = await ctx.newPage();
page.on('crash', () => console.log('CRASH')); page.on('close', () => console.log('CLOSE')); b.on('disconnected', () => console.log('DISCONNECTED'));
let auth = null;
await ctx.route(/book-recorder/, (r) => { const a = r.request().headers().authorization; if (a && !auth) auth = a; r.continue(); });
const hh = (t) => new Date(t).toISOString().slice(5, 16).replace('T', ' ') + 'Z';
try {
  console.log('login', (await login(page)).replace(/\?.*/, ''));
  await page.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA, null, { timeout: 90000 });
  await page.evaluate(() => { const c = window.STRYKER_VELA.cells()[0]; c.setSymbol('futures:NQ1!'); c.setTimeframe('5'); });
  for (let k = 0; k < 40 && !auth; k++) await page.waitForTimeout(1000);
  if (!auth) throw new Error('no recorder token seen (account not on the book tier?)');
  const get = async (p) => { const r = await fetch(REC + p, { headers: { authorization: auth, origin: 'https://tradezoro.com' } }); const tx = r.ok ? await r.text() : ''; return { s: r.status, left: r.headers.get('x-ts-fill-left'), kb: Math.round(tx.length / 1024), j: tx ? JSON.parse(tx) : null }; };
  const SYMS = (process.env.SYMS || 'NQ,MNQ,ES,MES').split(','), WINS = Number(process.env.WINS || 8);
  const now = Date.now();
  for (const sym of SYMS) {
    for (let w = 0; w < WINS; w++) {   // 8 x 6 h = 48 h
      const to = now - w * 6 * 3600000, from = to - 6 * 3600000;
      const a = await get('/ts-aux?symbol=' + sym + '&from=' + from + '&to=' + to);
      await new Promise((r) => setTimeout(r, 1200)); let t = await get('/ts-trades?sym=' + sym + '&from=' + from + '&to=' + to);
      for (let k = 0; k < 6 && t.j && Number(t.left) > 0; k++) t = await get('/ts-trades?sym=' + sym + '&from=' + from + '&to=' + to);
      const fp = a.j ? a.j.fp : [], d = t.j ? t.j.delta : [];
      console.log(sym, hh(from), '->', hh(to), '| aux', a.s, 'fpMin', fp.length, a.kb + 'KB', 'lv', fp.reduce((n, x) => n + x.lv.length, 0), fp.length ? hh(fp[0].t * 60000) + '..' + hh(fp[fp.length - 1].t * 60000) : '-',
        '| trades', t.s, 'left', t.left, 'deltaMin', d.length, d.length ? hh(d[0][0]) + '..' + hh(d[d.length - 1][0]) : '-', 'prints', t.j ? t.j.trades.length : '-');
    }
  }
} catch (e) { console.log('ERR', e.message); }
finally { await b.close(); }
