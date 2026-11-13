// Dumps the recorder Worker's 48 h big-print store for one symbol (SYM=NQ) to OUT=file.json (demo Pro login, token kept in memory).
//   flock /tmp/stryker-chrome.lock node tools/tests/bigtrades-real-feed-dump.mjs
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
  const sym = process.env.SYM || 'NQ', out = [], now = Date.now(); let floor = null;
  for (let w = 0; w < 8; w++) {   // 8 x 6 h = 48 h, newest first
    const to = now - w * 6 * 3600000, from = to - 6 * 3600000;
    let t = await get('/ts-trades?sym=' + sym + '&from=' + from + '&to=' + to);
    for (let k = 0; k < 8 && t.j && Number(t.left) > 0; k++) { await new Promise((r) => setTimeout(r, 1200)); t = await get('/ts-trades?sym=' + sym + '&from=' + from + '&to=' + to); }
    if (t.j) { out.push(...t.j.trades); floor = t.j.floor; }
    console.log(hh(from), 'status', t.s, 'prints', t.j ? t.j.trades.length : '-');
  }
  (await import('node:fs')).writeFileSync(process.env.OUT || 'nq-trades.json', JSON.stringify({ sym, floor, at: now, trades: out }));
} catch (e) { console.log('ERR', e.message); }
finally { await b.close(); }
