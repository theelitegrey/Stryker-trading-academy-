#!/usr/bin/env node
/**
 * TradeZoro: US earnings feeder. Run daily by .github/workflows/earnings-data.yml.
 * Source: Nasdaq's public earnings calendar JSON (https://api.nasdaq.com/api/calendar/earnings?date=YYYY-MM-DD),
 * no key. Next 21 days + the last 3 (weekdays only). Writes earnings.json:
 *   { generatedAt, source, items: [[date, symbol, name, when('bmo'|'amc'|''), epsEst|null, fiscalQtr]] }
 * Education only. Estimates change; the file is refreshed once a day, it is not live.
 *   node tools/fetch-earnings.js out/earnings.json [prev.json]
 */
const fs = require('fs');
const [out, prevPath] = [process.argv[2] || 'earnings.json', process.argv[3]];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const eps = (s) => { const n = parseFloat(String(s || '').replace(/[$,()]/g, '')); return Number.isFinite(n) ? (/^\(/.test(String(s)) ? -n : n) : null; };
const when = (t) => (t === 'time-pre-market' ? 'bmo' : t === 'time-after-hours' ? 'amc' : '');
const dayStr = (d) => d.toISOString().slice(0, 10);
async function one(date) {
  for (let a = 0; a < 3; a++) {
    try {
      const r = await fetch('https://api.nasdaq.com/api/calendar/earnings?date=' + date, { headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124 Safari/537.36', Accept: 'application/json', Origin: 'https://www.nasdaq.com', Referer: 'https://www.nasdaq.com/' }, signal: AbortSignal.timeout(15000) });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      const rows = (j && j.data && j.data.rows) || [];
      return rows.filter((x) => /^[A-Z.\-]{1,6}$/.test(x.symbol || '')).map((x) => [date, x.symbol, String(x.name || '').slice(0, 60), when(x.time), eps(x.epsForecast), String(x.fiscalQuarterEnding || '')]);
    } catch (e) { await sleep(1500 * (a + 1)); }
  }
  return null;
}
(async () => {
  const items = []; let ok = 0, bad = 0;
  for (let i = -3; i <= 21; i++) {
    const d = new Date(Date.now() + i * 86400000);
    if ([0, 6].includes(d.getUTCDay())) continue;
    const rows = await one(dayStr(d));
    if (rows) { ok++; items.push(...rows); } else bad++;
    await sleep(400);
  }
  if (!ok || items.length < 20) { console.error('too little data (' + items.length + ' rows, ' + bad + ' failed days); keeping previous file'); process.exit(1); }
  if (prevPath && bad && fs.existsSync(prevPath)) console.log(bad + ' day(s) failed; their rows are missing this run');
  fs.writeFileSync(out, JSON.stringify({ generatedAt: Date.now(), source: 'Nasdaq public earnings calendar', items }));
  console.log('wrote ' + items.length + ' rows, ' + ok + ' days ok, ' + bad + ' failed');
})();
