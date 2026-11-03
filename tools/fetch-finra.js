// FINRA off-exchange feeder (runs in .github/workflows/finra-data.yml; no key, public data only).
//   node tools/fetch-finra.js <previous.json|-> <out.json>
// Sources:
//   daily  https://cdn.finra.org/equity/regsho/daily/CNMSshvol<YYYYMMDD>.txt   (Reg SHO daily short sale volume; TotalVolume = FINRA-reported off-exchange volume)
//   weekly https://api.finra.org/data/group/otcMarket/name/weeklySummary        (ATS_W_SMBL = ATS volume, OTC_W_SMBL = other OTC volume, per symbol per week)
// Output (one small file, published to the `data-finra` branch):
//   { v:1, generatedAt, daily: { SYM: [[yyyymmdd, totalVolume, shortVolume], ...] }, weekly: { SYM: [[weekStart, atsShares, atsNotional, otcShares, otcNotional], ...] } }
// A failed source keeps the previous data for that part. Education only.
'use strict';
const fs = require('fs');

const SYMBOLS = ['SPY', 'QQQ', 'IWM', 'DIA', 'AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'META', 'TSLA', 'AMD', 'AVGO', 'NFLX', 'COIN', 'PLTR', 'SMCI', 'MU', 'INTC',
  'BA', 'JPM', 'BAC', 'GS', 'XOM', 'CVX', 'UBER', 'DIS', 'SOFI', 'F', 'PFE', 'WMT', 'COST', 'ORCL', 'CRM', 'ADBE', 'TLT', 'GLD', 'SLV', 'XLF', 'XLE', 'SMH', 'ARKK', 'MARA', 'HOOD', 'RIVN', 'NIO'];
const DAILY_KEEP = 90, WEEKLY_KEEP = 16;
const WANT = new Set(SYMBOLS);

// pure: one Reg SHO file's text -> { SYM: [total, short] } for the wanted symbols. CNMS lists the symbol once per file.
function parseRegSho(text, want = WANT) {
  const out = {};
  for (const line of String(text).split(/\r?\n/)) {
    const c = line.split('|');
    if (c.length < 5 || !want.has(c[1])) continue;
    const sv = Number(c[2]), tv = Number(c[4]);
    if (!Number.isFinite(sv) || !Number.isFinite(tv) || tv <= 0 || sv < 0) continue;
    out[c[1]] = [Math.round(tv), Math.round(sv)];
  }
  return out;
}
// pure: weekly API rows (both summary types, one symbol) -> [[weekStart, atsShares, atsNotional, otcShares, otcNotional]] oldest first.
function mergeWeekly(rows, keep = WEEKLY_KEEP) {
  const by = new Map();
  for (const r of rows) {
    const w = r.weekStartDate; if (!w) continue;
    const sh = Number(r.totalWeeklyShareQuantity), no = Number(r.totalNotionalSum);
    if (!(sh > 0) || !(no > 0)) continue;
    const e = by.get(w) || [w, 0, 0, 0, 0];
    if (r.summaryTypeCode === 'ATS_W_SMBL') { e[1] += Math.round(sh); e[2] += Math.round(no); }
    else if (r.summaryTypeCode === 'OTC_W_SMBL') { e[3] += Math.round(sh); e[4] += Math.round(no); }
    else continue;
    by.set(w, e);
  }
  return [...by.values()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).slice(-keep);
}
const ymd = (d) => d.toISOString().slice(0, 10).replace(/-/g, '');

async function getText(url, init) {
  const r = await fetch(url, Object.assign({ headers: { 'user-agent': 'tradezoro-finra-feeder' } }, init));
  return { ok: r.ok, status: r.status, text: r.ok ? await r.text() : '' };
}
async function fetchDaily(prev) {
  const daily = Object.assign({}, prev || {});
  const have = new Set(); Object.values(daily).forEach((a) => a.forEach((r) => have.add(r[0])));
  const today = new Date();
  let got = 0;
  for (let i = 1; i <= 110 && got < 60; i++) {
    const d = new Date(today.getTime() - i * 86400000), dow = d.getUTCDay();
    if (dow === 0 || dow === 6) continue;
    const day = ymd(d);
    if (have.has(day)) continue;
    const r = await getText('https://cdn.finra.org/equity/regsho/daily/CNMSshvol' + day + '.txt').catch(() => null);
    if (!r || !r.ok) continue;   // holiday / not published yet (403)
    const rows = parseRegSho(r.text);
    for (const s of Object.keys(rows)) (daily[s] = daily[s] || []).push([day, rows[s][0], rows[s][1]]);
    got++;
  }
  const cutoff = ymd(new Date(today.getTime() - 120 * 86400000));
  for (const s of Object.keys(daily)) daily[s] = daily[s].filter((r) => r[0] >= cutoff).sort((a, b) => (a[0] < b[0] ? -1 : 1)).slice(-DAILY_KEEP);
  return daily;
}
async function fetchWeekly(prev) {
  const weekly = Object.assign({}, prev || {});
  const since = new Date(Date.now() - 140 * 86400000).toISOString().slice(0, 10);
  let fails = 0;
  for (const sym of SYMBOLS) {
    const rows = [];
    for (const type of ['ATS_W_SMBL', 'OTC_W_SMBL']) {
      const body = { limit: 200, compareFilters: [
        { compareType: 'equal', fieldName: 'issueSymbolIdentifier', fieldValue: sym },
        { compareType: 'equal', fieldName: 'summaryTypeCode', fieldValue: type },
        { compareType: 'GREATER', fieldName: 'weekStartDate', fieldValue: since }] };
      const r = await getText('https://api.finra.org/data/group/otcMarket/name/weeklySummary', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json', 'user-agent': 'tradezoro-finra-feeder' }, body: JSON.stringify(body) }).catch(() => null);
      if (!r || !r.ok) { fails++; continue; }
      try { rows.push(...JSON.parse(r.text)); } catch (e) { fails++; }
    }
    const m = mergeWeekly(rows);
    if (m.length) weekly[sym] = m;
  }
  return { weekly, fails };
}
async function main() {
  const [prevPath, outPath] = process.argv.slice(2);
  let prev = {};
  try { if (prevPath && prevPath !== '-') prev = JSON.parse(fs.readFileSync(prevPath, 'utf8')); } catch (e) {}
  const daily = await fetchDaily(prev.daily);
  const { weekly, fails } = await fetchWeekly(prev.weekly);
  const nD = Object.keys(daily).length, nW = Object.keys(weekly).length;
  if (!nD && !nW) { console.error('no FINRA data at all'); process.exit(1); }
  const out = { v: 1, generatedAt: Date.now(), source: 'FINRA Reg SHO daily short sale volume files and OTC Transparency weekly summary', daily, weekly };
  fs.writeFileSync(outPath, JSON.stringify(out));
  console.log('daily symbols ' + nD + ', weekly symbols ' + nW + ', weekly request failures ' + fails);
}
if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
module.exports = { parseRegSho, mergeWeekly, SYMBOLS };
