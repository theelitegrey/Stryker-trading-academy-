// Data Bridge browser test against the REAL Python helper in --fake mode (no broker). Needs: python3 + websockets, a server on :8077.
// CHART_BASE=http://127.0.0.1:8077 node tools/tests/byo-bridge-browser.js [shotsDir]
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const { spawn } = require('child_process');
const os = require('os'), path = require('path');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8077';
const OUT = process.argv[2] || '/tmp';
let fail = 0;
const check = (ok, msg, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (x === undefined ? '' : ' ' + JSON.stringify(x).slice(0, 200))); };

function startHelper() {
  return new Promise((res, rej) => {
    const home = require('fs').mkdtempSync(path.join(os.tmpdir(), 'tzb-'));
    const pr = spawn('python3', ['-u', 'tools/bridge/helper/main.py', 'mt5', '--fake', '--dev-origin', new URL(BASE).origin], { env: { ...process.env, APPDATA: home }, cwd: path.resolve(__dirname, '..', '..') });
    let buf = ''; const to = setTimeout(() => rej(new Error('helper did not start: ' + buf)), 10000);
    pr.stdout.on('data', (d) => { buf += d; const m = /: (\d{4}) (\d{4})\n/.exec(buf); if (m) { clearTimeout(to); res({ pr, code: m[1] + m[2] }); } });
    pr.stderr.on('data', (d) => { buf += d; });
  });
}
async function open(b, w, h, mobile, theme) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, isMobile: !!mobile, hasTouch: !!mobile });
  await ctx.addInitScript(stub);
  await ctx.addInitScript((t) => { try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); if (t === 'day') localStorage.setItem('stryker_theme', 'day'); } catch (e) {} }, theme);
  await ctx.route(/^https?:\/\/[^/]*(gstatic|googleapis|firebase|google|doubleclick)\./, (r) => r.abort());
  const reqs = []; ctx.on('request', (r) => reqs.push(r.url()));
  const p = await ctx.newPage(); const logs = [];
  p.on('console', (m) => logs.push(m.text())); p.on('pageerror', (e) => logs.push('PAGEERR ' + e));
  await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA && document.querySelector('#byo-btn'), null, { timeout: 45000 });
  await p.waitForTimeout(800);
  return { ctx, p, logs, reqs };
}
(async () => {
  const b = await launch(); let helper = null;
  try {
    for (const [w, h, mobile, theme, tag] of [[1440, 900, false, 'dark', 'd1440'], [390, 844, true, 'dark', 'd390'], [1440, 900, false, 'day', 'l1440'], [390, 844, true, 'day', 'l390']]) {
      helper = await startHelper();
      const { ctx, p, logs, reqs } = await open(b, w, h, mobile, theme); const t = tag + ': ';
      await p.evaluate(() => document.querySelector('#byo-btn').click());
      await p.waitForSelector('.byo-row');
      const rows = await p.$$eval('.byo-row', (r) => r.map((x) => ({ id: x.dataset.src, txt: x.textContent, btn: x.querySelector('button').textContent })));
      for (const id of ['mt5', 'ninja', 'ibkr']) { const r = rows.find((x) => x.id === id); check(r && /Beta/.test(r.txt) && !/Download/.test(r.txt) && r.btn === 'Pair', t + id + ' row: Beta, Pair, no download link that skips the warning', r && r.btn); }
      check(!/MetaTrader|NinjaTrader|Interactive Brokers/.test(await p.evaluate(() => { const s = document.querySelector('#byo-sheet'); s.hidden = true; const x = document.body.innerText; s.hidden = false; return x; })), t + 'no vendor names outside the sheet');
      await p.screenshot({ path: `${OUT}/bridge-list-${tag}.png` });
      await p.click('.byo-row[data-src="mt5"] button'); await p.waitForSelector('#byo-f-code');
      await p.screenshot({ path: `${OUT}/bridge-pair-${tag}.png` });
      const wn = await p.evaluate(() => { const e = document.querySelector('.byo-warn'), a = document.querySelector('a.byo-dlrow'); return { warn: e && e.textContent, before: !!(e && a && (e.compareDocumentPosition(a) & 4)), href: a && a.href, guide: e && e.querySelector('a').getAttribute('href') }; });
      check(/More info, then Run anyway/.test(wn.warn || "") && /antivirus/.test(wn.warn) && wn.before && /releases\/download\/bridge-v1\.0\.0\/TradeZoroBridge\.exe$/.test(wn.href) && wn.guide === '/help/desktop-bridge', t + 'warning shown before the download link, links to the guide', wn);
      await p.fill('#byo-f-code', '00000000'); await p.click('.byo-go');
      await p.waitForSelector('.byo-err:not([hidden])', { timeout: 8000 });
      check(/not right/.test(await p.$eval('.byo-err:not([hidden])', (e) => e.textContent)), t + 'wrong code shows a plain message');
      await p.fill('#byo-f-code', helper.code); await p.click('.byo-go');
      await p.waitForSelector('#byo-forget', { timeout: 15000 });
      check(true, t + 'paired with the helper (manage view)');
      const r = await p.evaluate(async () => {
        const core = await import('/assets/byo-core.js?v=929'); const br = await import('/assets/byo-bridge.js?v=929');
        const rec = core.statusRec('mt5'); const ad = core.ADAPTERS.mt5; const out = {};
        const bars = await ad.getBars(rec.creds, 'byo:EURUSD', '1', { limit: 20 }); out.n = bars.length; out.ok = bars.every((x) => x.time > 1e12 && x.high >= x.low);
        const got = []; const off = ad.subscribe(rec.hub, 'byo:EURUSD', '1', bars[bars.length - 1], (c) => got.push(c));
        await new Promise((res) => setTimeout(res, 2500)); out.live = got.length; out.status = core.statusOf('mt5').status; off();
        try { br.guardSend({ t: 'order_send', sym: 'EURUSD' }); out.refused = false; } catch (e) { out.refused = /blocked/.test(e.message); }
        try { br.guardSend({ t: 'account' }); out.refused2 = false; } catch (e) { out.refused2 = /blocked/.test(e.message); }
        return out;
      });
      check(r.n === 20 && r.ok, t + 'history: 20 bars', r); check(r.live >= 1 && r.status === 'live', t + 'live tick builds a candle, status live', r); check(r.refused && r.refused2, t + 'order / account messages refused by the site', r);
      await p.screenshot({ path: `${OUT}/bridge-manage-${tag}.png` });
      check(!reqs.some((u) => /^https?:\/\/(?!127\.0\.0\.1|localhost)/.test(u) && /EURUSD|bars|tick/i.test(u)), t + 'no price data sent to any server');
      await p.click('#byo-forget'); await p.waitForSelector('.byo-row');
      check((await p.evaluate(() => new Promise((res) => { const q = indexedDB.open('tz-byo'); q.onsuccess = () => { const k = q.result.transaction('kv').objectStore('kv').getAllKeys(); k.onsuccess = () => res(k.result.filter((x) => String(x).startsWith('c:')).length); }; }))) === 0, t + 'Forget wipes the stored token');
      const ovf = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth); check(ovf <= 0, t + 'no horizontal overflow', ovf);
      check(!logs.some((l) => /PAGEERR/.test(l)), t + 'no page errors', logs.filter((l) => /PAGEERR/.test(l)));
      check(!logs.join('\n').includes(helper.code), t + 'pairing code not in console');
      await ctx.close(); helper.pr.kill(); await new Promise((res) => setTimeout(res, 500));
    }
  } finally { if (helper) helper.pr.kill(); await b.close(); }
  console.log(fail ? 'FAILED ' + fail : 'ALL PASS'); process.exit(fail ? 1 : 0);
})();
