#!/usr/bin/env node
// TradeZoro news + economic calendar feeder (this server -> book-recorder Worker).
// Owner approved 2026-10-14 (InsightSentry commercial licence). Runs once per systemd timer tick
// (news-feeder.timer, every 2 min). Node 22, no dependencies. Imports the SAME compacting and
// tagging code the Worker validates against (news.js, installed next to this file).
//
// Every run:
//   NEWS  GET /v3/newsfeed?limit=200 (newest first). If the oldest item on the page is newer than
//         the newest item we sent last time, the next page is fetched too (at most NEWS_PAGES).
//         Items are compacted (compactNews: title, source, link, <= 280-char summary, tags) and
//         POSTed to <Worker>/news-ingest. The Worker dedupes by id and keeps 7 days.
//   CAL   every CAL_EVERY_S (15 min, kept in the state file): /v3/calendar/events w=1..3 (all
//         importances, all countries, ~3 weeks), /v3/calendar/earnings w=1..2 (market cap >= 10 B
//         USD), /v3/calendar/dividends w=1 (>= 20 B), /v3/calendar/ipos w=1..2.
// First run (no state file) or --backfill: also pulls up to 7 days of news for our markets with
// keyword-filtered queries (one per tag group), so the panel is not empty on day one.
//
// Rate limit (measured 2026-10-14): InsightSentry sends no rate-limit headers; 12 back-to-back
// /v3/newsfeed requests all returned 200 (0.05-1.1 s). We stay far below that: 1 news request per
// 2 min normally (720/day) + 7 calendar requests per 15 min (672/day). A 429 is logged and the
// run backs off (the next tick tries again); nothing is retried in a loop.
//
// Config (env): INSIGHTSENTRY_WEBSOCKET_API_KEY (EnvironmentFile
// /root/.hermes/profiles/chief-of-staff/scripts/insightsentry.env, never logged),
// BOOK_RECORDER_URL + BOOK_INGEST_SECRET (/root/projects/book-feeder/feeder.env, never logged).
// State: /var/lib/news-feeder/state.json (newest sent time, last calendar run).
// Memory: one page (<= ~0.5 MB JSON) at a time; RSS ~45 MB.
import fs from 'node:fs';
import path from 'node:path';
// installed copy: news.mjs next to this file (install.sh); in the repo: ../src/news.js
const N = await import('./news.mjs').catch(() => import('../src/news.js'));
const { compactNews, compactEvent, NEWS_KEEP_S } = N;

const API = 'https://api.insightsentry.com/v3';
const NEWS_LIMIT = 200, NEWS_PAGES = 5;
// InsightSentry MONTHLY REST quota (2026-10-25, CoS "is monthly quota 1026"): news every 2 min + 8 calendar calls every
// 15 min, 24/7, was ~1,440 calls a day. Now: news every NEWS_EVERY_S (5 min on weekdays, 30 min from Fri 17:00 ET to
// Sun 17:00 ET) and the calendar every CAL_EVERY_S (60 min; 15 min on weekdays 07:00-11:00 ET when most actuals print).
// The timer still ticks every 2 min; this script decides. Every IS call is posted to the recorder's /is-note.
const NEWS_EVERY_S = 5 * 60, NEWS_EVERY_WE_S = 30 * 60, CAL_EVERY_S = 60 * 60, CAL_EVERY_HOT_S = 15 * 60;
let isCalls = 0;
export function etParts(ms) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { dow: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday), min: Number(p.hour) * 60 + Number(p.minute) };
}
// weekend = Fri 17:00 ET .. Sun 17:00 ET (futures closed)
export function isWeekendEt(ms) { const { dow, min } = etParts(ms); return dow === 6 || (dow === 5 && min >= 17 * 60) || (dow === 0 && min < 17 * 60); }
export function newsEvery(ms) { return isWeekendEt(ms) ? NEWS_EVERY_WE_S : NEWS_EVERY_S; }
export function calEvery(ms) { const { dow, min } = etParts(ms); return dow >= 1 && dow <= 5 && min >= 7 * 60 && min < 11 * 60 ? CAL_EVERY_HOT_S : CAL_EVERY_S; }
const STATE = process.env.NEWS_FEEDER_STATE || '/var/lib/news-feeder/state.json';
const KEY = process.env.INSIGHTSENTRY_WEBSOCKET_API_KEY || process.env.INSIGHTSENTRY_API_KEY || '';
const REC = String(process.env.BOOK_RECORDER_URL || '').replace(/\/+$/, '');
const SECRET = process.env.BOOK_INGEST_SECRET || '';
const args = new Set(process.argv.slice(2));
const log = (...a) => console.log(...a);

// Keyword groups for the 7-day backfill (each <= 10 values, >= 2 chars, IS `keywords` filter).
// No spaces: IS splits values on spaces AND commas (10 values max), so a phrase would count twice.
export const BACKFILL = [
  'nasdaq,s&p,dow,stocks',
  'fed,fomc,powell,inflation,cpi,payrolls,yields,jobless,gdp',
  'gold,silver,bullion',
  'crude,oil,brent,wti,opec',
  'bitcoin,ethereum,crypto,ether'
];

async function is(pathq) {
  isCalls++;
  const r = await fetch(API + pathq, { headers: { Authorization: 'Bearer ' + KEY, 'accept-encoding': 'gzip' }, signal: AbortSignal.timeout(30000) });
  if (r.status === 429) throw Object.assign(new Error('InsightSentry 429 (rate limited) on ' + pathq.split('?')[0]), { rl: true });
  if (!r.ok) throw new Error('InsightSentry HTTP ' + r.status + ' on ' + pathq.split('?')[0]);
  return r.json();
}
async function post(route, body) {
  const r = await fetch(REC + route, { method: 'POST', headers: { 'content-type': 'application/json', 'x-ingest-key': SECRET }, body: JSON.stringify(body), signal: AbortSignal.timeout(20000) });
  const t = (await r.text()).slice(0, 200);
  if (!r.ok) throw new Error(route + ' HTTP ' + r.status + ': ' + t);
  return t;
}
function readState() { try { return JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch (e) { return null; } }
function writeState(s) { fs.mkdirSync(path.dirname(STATE), { recursive: true }); fs.writeFileSync(STATE + '.tmp', JSON.stringify(s)); fs.renameSync(STATE + '.tmp', STATE); }

// Raw newsfeed pages -> compact items, newest first, deduped by id within the batch.
export function compactPage(data, seen) {
  const out = [];
  for (const it of (data && data.data) || []) {
    const c = compactNews(it);
    if (!c || seen.has(c.id)) continue;
    seen.add(c.id); out.push(c);
  }
  return out;
}
async function sendNews(items) {
  let sent = 0;
  for (let i = 0; i < items.length; i += 400) { await post('/news-ingest', { items: items.slice(i, i + 400) }); sent += Math.min(400, items.length - i); }
  return sent;
}

async function runNews(state) {
  const seen = new Set(), items = [];
  let newest = 0, raw = 0;
  for (let page = 1; page <= NEWS_PAGES; page++) {
    const d = await is('/newsfeed?limit=' + NEWS_LIMIT + '&page=' + page);
    const list = d.data || [];
    raw += list.length;
    items.push(...compactPage(d, seen));
    const ts = list.map((x) => Number(x.published_at)).filter((t) => t > 0);
    if (ts.length) newest = Math.max(newest, ...ts);
    const oldest = ts.length ? Math.min(...ts) : 0;
    if (!d.has_next || !state.newsT || oldest <= state.newsT) break;
  }
  const nowSec = Math.floor(Date.now() / 1000);
  const fresh = items.filter((x) => x.t >= nowSec - NEWS_KEEP_S && x.t <= nowSec + 600);
  const sent = fresh.length ? await sendNews(fresh) : 0;
  log('news: ' + raw + ' raw, ' + sent + ' kept and sent');
  if (newest) state.newsT = newest;
}
async function runBackfill() {
  const from = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  const seen = new Set();
  let total = 0;
  for (const kw of BACKFILL) {
    for (let page = 1; page <= 3; page++) {
      const d = await is('/newsfeed?limit=500&page=' + page + '&from=' + from + '&keywords=' + encodeURIComponent(kw));
      const items = compactPage(d, seen);
      if (items.length) total += await sendNews(items);
      if (!d.has_next) break;
    }
  }
  log('news backfill (7 days, our markets): ' + total + ' sent');
}

// ---- calendar ---------------------------------------------------------------------------------
const day = (ms) => new Date(ms).toISOString().slice(0, 10);
function rangeOf(d) { const m = /From (\d{4}-\d{2}-\d{2}) to (\d{4}-\d{2}-\d{2})/.exec(d && d.range || ''); return m ? [m[1], m[2]] : null; }
const num = (v, k) => (Number.isFinite(v) ? Number(v.toFixed(k == null ? 4 : k)) : null);

// Earnings row -> compact: reported in the window (t = release, actual vs estimate) or upcoming
// (t = next release, estimate only).
export function compactEarning(e, f, t) {
  const last = Number(e.earnings_release_date) * 1000, next = Number(e.earnings_release_next_date) * 1000;
  const base = { code: String(e.code), n: String(e.name || '').slice(0, 60), cap: Math.round((e.market_cap || 0) / 1e6), c: String(e.country || '').slice(0, 20), cur: e.currency_code || 'USD' };
  if (last >= f && last < t) return Object.assign(base, { t: last, done: 1, eps: num(e.earnings_per_share_fq), epsF: num(e.earnings_per_share_forecast_fq), rev: num(e.revenue_fq, 0), revF: num(e.revenue_forecast_fq, 0) });
  if (next >= f && next < t) return Object.assign(base, { t: next, epsF: num(e.earnings_per_share_forecast_next_fq), revF: num(e.revenue_forecast_next_fq, 0) });
  return null;
}
export function compactDividend(e, f, t) {
  const up = Number(e.dividend_ex_date_upcoming) * 1000, rec = Number(e.dividend_ex_date_recent) * 1000;
  const useUp = up >= f && up < t;
  const ex = useUp ? up : rec;
  if (!(ex >= f && ex < t)) return null;
  return { code: String(e.code), n: String(e.name || '').slice(0, 60), cap: Math.round((e.market_cap || 0) / 1e6), c: String(e.country || '').slice(0, 20), cur: e.currency_code || 'USD',
    t: ex, amt: num(useUp ? e.dividend_amount_upcoming : e.dividend_amount_recent), pay: (Number(useUp ? e.dividend_payment_date_upcoming : e.dividend_payment_date_recent) * 1000) || null, y: num(e.dividends_yield, 2) };
}
export function compactIpo(e) {
  const t = Number(e.offer_time) * 1000;
  if (!(t > 0)) return null;
  return { code: String(e.code), n: String(e.name || '').slice(0, 60), c: String(e.country || '').slice(0, 20), cur: e.currency || 'USD', t, x: String(e.exchange || '').slice(0, 12),
    st: String(e.status || '').slice(0, 16), px: num(e.offer_price), pr: e.price_range ? String(e.price_range).slice(0, 24) : null, deal: num(e.deal_amount, 0), cap: Math.round((e.market_cap || 0) / 1e6) };
}
async function runCal() {
  // economic events: w=1..3 (this week through ~3 weeks out); each day the feed covers is replaced whole
  const evs = new Map(); let f = null, t = null;
  for (const w of [1, 2, 3]) {
    const d = await is('/calendar/events?w=' + w);
    const r = rangeOf(d);
    if (r) { f = f && f < r[0] ? f : r[0]; t = t && t > r[1] ? t : r[1]; }
    for (const e of d.data || []) { const c = compactEvent(e); if (c) evs.set(c.t + '|' + c.c + '|' + c.ti, c); }
  }
  if (f && t) {
    // the range end day may be partial: claim only [from, to)
    const days = [];
    for (let x = Date.parse(f + 'T00:00:00Z'); x < Date.parse(t + 'T00:00:00Z'); x += 86400000) days.push(day(x));
    const items = [...evs.values()].filter((e) => days.includes(day(e.t)));
    log('calendar events: ' + items.length + ' over ' + days.length + ' days -> ' + await post('/cal-ingest?kind=events', { fetched_at: Date.now(), days, items }));
  }
  const kinds = [['earnings', [1, 2], 10000, compactEarning], ['dividends', [1], 20000, compactDividend], ['ipos', [1, 2], 0, null]];
  for (const [kind, ws, minCapM, fn] of kinds) {
    const rows = new Map();
    for (const w of ws) {
      const d = await is('/calendar/' + kind + '?w=' + w);
      const r = rangeOf(d);
      const fa = r ? Date.parse(r[0] + 'T00:00:00Z') : Date.now() - 86400000, ta = r ? Date.parse(r[1] + 'T00:00:00Z') + 86400000 : Date.now() + 8 * 86400000;
      for (const e of d.data || []) {
        if (minCapM && !((e.market_cap || 0) >= minCapM * 1e6)) continue;
        const c = fn ? fn(e, fa, ta) : compactIpo(e);
        if (c) rows.set(c.code + '|' + c.t, c);
      }
    }
    const items = [...rows.values()].sort((a, b) => a.t - b.t);
    log('calendar ' + kind + ': ' + items.length + ' -> ' + await post('/cal-ingest?kind=' + kind, { fetched_at: Date.now(), items }));
  }
}

async function main() {
  if (!KEY || !REC || !SECRET) { console.error('news-feeder: missing env (InsightSentry key, BOOK_RECORDER_URL or BOOK_INGEST_SECRET)'); process.exit(2); }
  const state = readState() || { first: true };
  const nowSec = Math.floor(Date.now() / 1000);
  let failed = false;
  try {
    // a failed backfill must not block the normal pull (it is retried on the next run)
    if (state.first || args.has('--backfill')) {
      try { await runBackfill(); delete state.first; } catch (e) { failed = true; console.error('backfill: ' + e.message); }
    }
    if (args.has('--news') || !state.newsAt || nowSec - state.newsAt >= newsEvery(Date.now()) - 30) { await runNews(state); state.newsAt = nowSec; }
  } catch (e) { failed = true; console.error('news: ' + e.message); }
  if (args.has('--cal') || !state.calAt || nowSec - state.calAt >= calEvery(Date.now()) - 30) {
    try { await runCal(); state.calAt = nowSec; } catch (e) { failed = true; console.error('calendar: ' + e.message); }
  }
  writeState(state);
  if (isCalls) { try { await post('/is-note', { src: 'news', n: isCalls }); } catch (e) { console.error('is-note: ' + e.message); } }
  log('rss ' + Math.round(process.memoryUsage().rss / 1e6) + ' MB');
  if (failed) process.exitCode = 1;
}
if (String(process.argv[1] || '').endsWith('news_feeder.mjs')) main();
