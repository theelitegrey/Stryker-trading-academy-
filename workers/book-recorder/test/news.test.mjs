// News + economic calendar: unit tests (symbol tagging, dedupe, replay cut-off, validation) and a
// local round trip through the real Worker + Durable Object on node:sqlite (feeder -> /news-ingest
// -> /news). Fixtures are hand-written in the shape InsightSentry sends (no licensed text in the repo).
//   node workers/book-recorder/test/news.test.mjs
import assert from 'node:assert/strict';
import {
  tagNews, parseRelated, compactNews, newsId, mergeNews, queryNews, feedTags, validateNewsItems, cleanSummary,
  compactEvent, validateCal, calRange, SUMMARY_MAX
} from '../src/news.js';
import { newsParams } from '../src/news-routes.js';
import { compactEarning, compactDividend, compactIpo, compactPage } from '../news-feeder/news_feeder.mjs';

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; console.log('PASS', m); };
const eq = (a, b, m) => { assert.deepEqual(a, b, m); n++; console.log('PASS', m); };

// ---- tagging -----------------------------------------------------------------------------------
eq(parseRelated("['NASDAQ:AAPL', 'NYSE:JPM']"), ['NASDAQ:AAPL', 'NYSE:JPM'], 'related_symbols string from IS parsed');
eq(parseRelated(['CME_MINI:NQ1!']), ['CME_MINI:NQ1!'], 'related_symbols array accepted');
eq(parseRelated(''), [], 'empty related_symbols');
eq(tagNews('Soybeans retreat on harvest progress', ['CBOT:ZS1!']), [], 'grains: no tag of ours');
eq(tagNews('Apple unveils new iPhone', ['NASDAQ:AAPL']), ['ES', 'NQ', 'STOCKS', 'YM'], 'mega-cap Dow member -> NQ, ES, YM');
eq(tagNews('Nvidia shares climb', ['NASDAQ:NVDA']), ['ES', 'NQ', 'STOCKS', 'YM'], 'NVDA -> NQ/ES/YM');
eq(tagNews('Gold hits record as dollar slips', []), ['GC'], 'keyword gold -> GC');
eq(tagNews('Precious metals rally', []), ['GC', 'SI'], 'precious metals -> GC + SI');
eq(tagNews('Oil prices jump after OPEC+ cut', []), ['CL'], 'oil / OPEC -> CL');
eq(tagNews('Bitcoin tops $100k; ether follows', []), ['BTC', 'CRYPTO', 'ETH'], 'bitcoin + ether -> BTC, ETH, CRYPTO');
eq(tagNews("Fed's Barkin: rates may stay higher", []), ['MACRO'], 'Fed speaker -> MACRO');
eq(tagNews('US CPI rises 0.6% in September', []), ['MACRO'], 'CPI -> MACRO');
eq(tagNews('S&P 500 futures edge higher', []), ['ES'], 'S&P 500 -> ES');
eq(tagNews('S&P Global Is Maintained at Overweight', []), [], 'S&P Global (a company) is not the index');
eq(tagNews('Nasdaq-listed biotech files for IPO', []), [], '"Nasdaq-listed" is not the index');
eq(tagNews('Dow futures slip', []), ['YM'], 'Dow futures -> YM');
eq(tagNews('Shell earnings', ['LSE:SHEL', 'TVC:UKOIL']), ['CL'], 'related UKOIL -> CL');
eq(tagNews('x', ['CME_MINI:NQ1!', 'COMEX:GC1!']), ['GC', 'NQ'], 'IS futures symbols -> tags');
eq(tagNews('USDA grants loan to co-op', ['FX:FED30D', 'SP:SPX', 'IS:DJI', 'FX:EURUSD', 'CBOE:VIX', 'IS:UKOIL', 'IS:USOIL', 'NASDAQ:IXIC']), ['MACRO'], 'wide related basket -> MACRO, not CL/ES/NQ/YM');
eq(tagNews('ETF flows page', ['NASDAQ:AAPL', 'NASDAQ:MSFT', 'NYSE:X', 'NYSE:Y']), [], 'many-company story does not tag the index');
eq(tagNews('Gold Fields launches offer', []), [], 'Gold Fields (a miner) is not gold');
eq(feedTags('nq'), ['NQ', 'MACRO'], 'NQ feed = NQ + macro');
eq(feedTags('BTC'), ['BTC', 'CRYPTO'], 'BTC feed = BTC + crypto');
eq(feedTags('XYZ'), null, 'unknown symbol has no feed');

// ---- compacting --------------------------------------------------------------------------------
const T = Math.floor(Date.UTC(2026, 9, 14, 17, 0) / 1000);
const raw = (o) => Object.assign({ source: 'Reuters', title: 'Gold rises', content: 'Gold prices rose on Tuesday.', published_at: String(T), related_symbols: '' }, o);
const c1 = compactNews(raw({ link: 'https://example.com/a' }));
eq(Object.keys(c1).sort(), ['g', 'h', 'id', 'm', 's', 't', 'u'], 'compact item fields');
ok(c1.t === T && c1.u === 'https://example.com/a' && c1.g[0] === 'GC', 'compact item values');
ok(compactNews(raw({ link: 'javascript:alert(1)' })).u === undefined, 'non-https link dropped');
ok(compactNews(raw({ title: '' })) === null, 'no title -> dropped');
ok(compactNews(raw({ published_at: 'x' })) === null, 'no time -> dropped');
ok(compactNews(raw({ title: 'Xcel Energy Is Maintained at Buy by Truist', source: 'Dow Jones Newswires', related_symbols: "['NASDAQ:XEL']" })) === null, 'rating noise on other stocks dropped');
ok(compactNews(raw({ title: 'Nvidia Price Target Raised to $250 by Truist', related_symbols: "['NASDAQ:NVDA']" })) !== null, 'rating on an index heavyweight kept');
ok(compactNews(raw({ title: 'Local bakery opens second shop', source: 'Some PR Wire' })) === null, 'untagged item from a non-market desk dropped');
ok(compactNews(raw({ title: 'Houthis bring the war to Riyadh', source: 'Reuters' })) !== null, 'untagged item from a market desk kept (All markets)');
const long = compactNews(raw({ content: 'word '.repeat(200) }));
ok(long.m.length <= SUMMARY_MAX + 1 && long.m.endsWith('…'), 'summary capped at ' + SUMMARY_MAX + ' chars');
ok(cleanSummary('Gold rises', 'Gold rises') === '', 'summary that only repeats the title dropped');
ok(!/https?:/.test(cleanSummary('See https://x.com/y for more on gold', 't')), 'URLs stripped from the summary');

// ---- dedupe ------------------------------------------------------------------------------------
ok(newsId('Gold rises!') === newsId('gold   rises'), 'same headline (case/punctuation) -> same id');
ok(newsId('Gold rises') !== newsId('Gold falls'), 'different headline -> different id');
const map = new Map();
mergeNews(map, [{ id: 'a', t: T + 60, s: 'Reuters', h: 'Gold rises', g: ['GC'] }]);
const touched = mergeNews(map, [{ id: 'a', t: T, s: 'Dow Jones', h: 'Gold rises', g: ['SI'], u: 'https://x.y/z', m: 'sum' }]);
const a = map.get('a');
ok(map.size === 1 && a.t === T && a.u === 'https://x.y/z' && a.m === 'sum', 'duplicate merges: earliest time, link + summary filled in');
eq(a.g, ['GC', 'SI'], 'duplicate merges tags');
ok(touched.has(Math.floor(T / 3600)), 'merge reports the hour bucket it changed');
const seen = new Set();
const page = compactPage({ data: [raw({}), raw({ title: 'GOLD RISES' }), raw({ title: 'Silver slips' })] }, seen);
ok(page.length === 2, 'feeder dedupes inside one page');
ok(compactPage({ data: [raw({})] }, seen).length === 0, 'feeder dedupes across pages of the same run');

// ---- query + replay cut-off ---------------------------------------------------------------------
const items = [
  { id: '1', t: T - 7200, s: 'Reuters', h: 'Gold rises', g: ['GC'] },
  { id: '2', t: T - 3600, s: 'Reuters', h: 'Fed holds rates', g: ['MACRO'] },
  { id: '3', t: T, s: 'CoinDesk', h: 'Bitcoin jumps', g: ['BTC', 'CRYPTO'] },
  { id: '4', t: T + 3600, s: 'Reuters', h: 'Nasdaq futures slide', g: ['NQ'] },
  { id: '5', t: T + 60, s: 'Reuters', h: 'War headline', g: [] }
];
eq(queryNews(items, {}).map((x) => x.id), ['4', '5', '3', '2', '1'], 'all markets: everything, newest first');
eq(queryNews(items, { sym: 'NQ' }).map((x) => x.id), ['4', '2'], 'NQ feed: NQ + macro');
eq(queryNews(items, { sym: 'GC' }).map((x) => x.id), ['2', '1'], 'GC feed: gold + macro');
eq(queryNews(items, { sym: 'BTC' }).map((x) => x.id), ['3'], 'BTC feed: crypto only');
eq(queryNews(items, { sym: 'NQ', to: T }).map((x) => x.id), ['2'], 'replay cut-off: nothing after `to`');
eq(queryNews(items, { to: T - 3600 }).map((x) => x.id), ['2', '1'], 'cut-off is inclusive of the bar time');
eq(queryNews(items, { q: 'gold' }).map((x) => x.id), ['1'], 'search on title');
eq(queryNews(items, { q: 'reuters fed' }).map((x) => x.id), ['2'], 'search: all words must match (source + title)');
eq(queryNews(items, { sym: 'XYZ' }), [], 'unknown symbol -> nothing');
const nowS = T + 30;
const sp = (o) => new URLSearchParams(o);
const p1 = newsParams(sp({ sym: 'nq', to: String((T - 100) * 1000) }), nowS);
ok(p1.sym === 'NQ' && p1.to === Math.ceil((T - 100) / 60) * 60 && p1.to <= T, 'newsParams: ms accepted, `to` rounded up to the minute');
ok(newsParams(sp({ to: String(T + 86400) }), nowS).to === Math.ceil(nowS / 60) * 60, 'newsParams: `to` never past the current minute');
ok(newsParams(sp({ sym: 'AAPL' }), nowS) === null, 'newsParams: unknown sym refused');
ok(newsParams(sp({ q: '<script>"x' }), nowS).q === 'script x', 'newsParams: query cleaned');
ok(newsParams(sp({ from: '1' }), nowS).from >= nowS - 7 * 86400 - 3600, 'newsParams: at most 7 days back');

// ---- validation ---------------------------------------------------------------------------------
ok(validateNewsItems([c1], T).items.length === 1, 'valid item accepted');
ok(!!validateNewsItems([Object.assign({}, c1, { t: T + 3600 })], T).error, 'future item refused');
ok(!!validateNewsItems([Object.assign({}, c1, { u: 'http://insecure' })], T).error, 'http link refused');
ok(!!validateNewsItems([Object.assign({}, c1, { h: 'x'.repeat(400) })], T).error, 'overlong title refused');
ok(!!validateNewsItems([], T).error, 'empty batch refused');

// ---- calendar -----------------------------------------------------------------------------------
const ev = compactEvent({ importance: 'high', title: 'Inflation Rate YoY', country: 'US', type: 'Inflation Rate', actual: 3.7, previous: 3.4, forecast: 3.6, currency: 'USD', unit: '%', date: '2026-10-14T12:30:00.000Z' });
eq(ev, { t: Date.UTC(2026, 9, 14, 12, 30), c: 'US', cur: 'USD', i: 'high', ti: 'Inflation Rate YoY', ty: 'Inflation Rate', a: 3.7, f: 3.6, p: 3.4, u: '%' }, 'economic event compacted');
ok(compactEvent({ importance: 'low', title: 'Diwali', country: 'IN', type: 'Holidays', date: '2026-10-20T00:00:00Z' }).i === 'holiday', 'holiday type -> holiday');
ok(compactEvent({ title: 'x', date: 'bad' }) === null, 'bad date dropped');
const nowMs = Date.UTC(2026, 9, 14, 18);
ok(validateCal('events', { fetched_at: nowMs, days: ['2026-10-14'], items: [ev] }, nowMs).ok, 'events ingest valid');
ok(!!validateCal('events', { fetched_at: nowMs, days: ['2026-10-15'], items: [ev] }, nowMs).error, 'event outside its claimed days refused');
ok(!!validateCal('events', { fetched_at: nowMs - 3600000, days: ['2026-10-14'], items: [ev] }, nowMs).error, 'stale calendar refused');
ok(!!validateCal('stocks', { fetched_at: nowMs, items: [] }, nowMs).error, 'unknown kind refused');
eq(calRange('2026-10-01', '2026-12-31', nowMs), { from: '2026-10-01', to: '2026-11-14' }, 'calendar range capped at 45 days');
ok(calRange('2026-10-10', '2026-10-01', nowMs) === null, 'reversed range refused');
const f = Date.UTC(2026, 9, 13), t2 = Date.UTC(2026, 9, 21);
const er = compactEarning({ code: 'NYSE:JPM', name: 'JP Morgan', market_cap: 8e11, country: 'US', earnings_release_date: Date.UTC(2026, 9, 14, 11) / 1000, earnings_release_next_date: Date.UTC(2027, 0, 14) / 1000, earnings_per_share_fq: 5.57, earnings_per_share_forecast_fq: 5.93, revenue_fq: 5.0e10, revenue_forecast_fq: 5.1e10 }, f, t2);
ok(er.done === 1 && er.eps === 5.57 && er.t === Date.UTC(2026, 9, 14, 11), 'earnings reported in the window: actual vs estimate');
const er2 = compactEarning({ code: 'NASDAQ:NFLX', name: 'Netflix', market_cap: 4e11, earnings_release_date: Date.UTC(2026, 6, 16) / 1000, earnings_release_next_date: Date.UTC(2026, 9, 16, 20) / 1000, earnings_per_share_forecast_next_fq: 6.1 }, f, t2);
ok(!er2.done && er2.epsF === 6.1, 'upcoming earnings: estimate only');
ok(compactEarning({ code: 'X', earnings_release_date: 1, earnings_release_next_date: 2 }, f, t2) === null, 'earnings outside the window dropped');
const dv = compactDividend({ code: 'NYSE:KO', name: 'Coca-Cola', market_cap: 3e11, dividend_ex_date_upcoming: Date.UTC(2026, 9, 15) / 1000, dividend_amount_upcoming: 0.51, dividends_yield: 2.9 }, f, t2);
ok(dv.amt === 0.51 && dv.t === Date.UTC(2026, 9, 15), 'dividend: ex-date + amount');
ok(compactIpo({ code: 'NYSE:NEW', name: 'New Co', offer_time: Date.UTC(2026, 9, 16) / 1000, status: 'Expected' }).st === 'Expected', 'IPO compacted');

console.log('\n' + n + ' checks passed');

// ---- local Worker + DO round trip (node:sqlite) ---------------------------------------------------
let sqlite = null;
try { sqlite = await import('node:sqlite'); } catch (e) { console.log('SKIP local Worker round trip (no node:sqlite)'); }
if (sqlite) {
  const nodeCrypto = await import('node:crypto');
  crypto.subtle.timingSafeEqual = (x, y) => nodeCrypto.timingSafeEqual(Buffer.from(x), Buffer.from(y));
  const { default: worker, BookRecorder } = await import('../src/index.js');
  const db = new sqlite.DatabaseSync(':memory:');
  const sql = { exec(q, ...p) { const st = db.prepare(q); const sel = /^\s*SELECT/i.test(q); const rows = sel ? st.all(...p) : (st.run(...p), []); return { toArray: () => rows }; }, get databaseSize() { return 0; } };
  const SECRET = 'k'.repeat(40);
  const env = { INGEST_SECRET: SECRET, SYMBOLS: 'BTCUSDT,ETHUSDT' };
  const dobj = new BookRecorder({ storage: { sql, deleteAlarm: async () => {} } }, env);
  env.RECORDER = { idFromName: () => 'id', get: () => ({ fetch: (u, init) => dobj.fetch(new Request(u, init)) }) };
  const store = new Map();
  globalThis.caches = { default: { match: async (r) => store.get(r.url)?.clone(), put: async (r, res) => { store.set(r.url, res); } } };
  const W = (p, init) => worker.fetch(new Request('https://w.dev' + p, init), env, { waitUntil: (x) => x });
  const now = Math.floor(Date.now() / 1000);
  const its = [
    { id: 'g1', t: now - 7200, s: 'Reuters', h: 'Gold rises', g: ['GC'], m: 'Gold rose.' },
    { id: 'f1', t: now - 600, s: 'Reuters', h: 'Fed holds', g: ['MACRO'], u: 'https://example.com/f' },
    { id: 'old', t: now - 9 * 86400, s: 'Reuters', h: 'Too old', g: ['GC'] }
  ];
  let r = await W('/news-ingest', { method: 'POST', body: JSON.stringify({ items: its }) });
  ok(r.status === 401, 'local: /news-ingest without the key -> 401');
  r = await W('/news-ingest', { method: 'POST', body: JSON.stringify({ items: its }), headers: { 'x-ingest-key': SECRET } });
  ok(r.status === 400, 'local: a batch with an item older than 7 days + 1 day is refused');
  r = await W('/news-ingest', { method: 'POST', body: JSON.stringify({ items: its.slice(0, 2) }), headers: { 'x-ingest-key': SECRET } });
  const ing = await r.json();
  ok(r.status === 200 && ing.added === 2, 'local: ingest stores 2 items');
  r = await W('/news-ingest', { method: 'POST', body: JSON.stringify({ items: [Object.assign({}, its[0], { t: now - 7300, u: 'https://example.com/g' })] }), headers: { 'x-ingest-key': SECRET } });
  ok((await r.json()).added === 0, 'local: re-sent item deduped (0 added)');
  dobj.newsAll = null;
  r = await W('/news?sym=GC', { headers: { origin: 'https://strykertrading.com' } });
  const j = await r.json();
  ok(r.status === 200 && r.headers.get('access-control-allow-origin') === 'https://strykertrading.com', 'local: /news CORS for our origin');
  eq(j.items.map((x) => x.id), ['f1', 'g1'], 'local: GC feed newest first (macro + gold)');
  ok(j.items[1].t === now - 7300 && j.items[1].u === 'https://example.com/g', 'local: merged duplicate kept the earliest time + the link');
  r = await W('/news?sym=GC&to=' + (now - 3600));
  eq((await r.json()).items.map((x) => x.id), ['g1'], 'local: replay cut-off via `to`');
  r = await W('/news', { headers: { origin: 'https://evil.example' } });
  ok(r.status === 403, 'local: foreign origin refused');
  const day = new Date(Date.now()).toISOString().slice(0, 10);
  const e1 = { t: Date.parse(day + 'T12:30:00Z'), c: 'US', cur: 'USD', i: 'high', ti: 'CPI', ty: 'Inflation' };
  r = await W('/cal-ingest?kind=events', { method: 'POST', body: JSON.stringify({ fetched_at: Date.now(), days: [day], items: [e1] }), headers: { 'x-ingest-key': SECRET } });
  ok(r.status === 200, 'local: calendar events ingest');
  r = await W('/cal?kind=events&from=' + day + '&to=' + day);
  const cj = await r.json();
  ok(cj.items.length === 1 && cj.items[0].ti === 'CPI' && cj.days[0] === day, 'local: /cal returns the day');
  r = await W('/cal-ingest?kind=events', { method: 'POST', body: JSON.stringify({ fetched_at: Date.now(), days: [day], items: [] }), headers: { 'x-ingest-key': SECRET } });
  store.clear();
  r = await W('/cal?kind=events&from=' + day + '&to=' + day);
  ok((await r.json()).items.length === 0, 'local: a re-fetched day replaces the old rows (cancelled event gone)');
  r = await W('/cal-ingest?kind=earnings', { method: 'POST', body: JSON.stringify({ fetched_at: Date.now(), items: [{ code: 'NYSE:JPM', t: Date.now(), n: 'JPM' }] }), headers: { 'x-ingest-key': SECRET } });
  r = await W('/cal?kind=earnings');
  ok((await r.json()).items[0].code === 'NYSE:JPM', 'local: earnings stored + served');
  r = await W('/status');
  const st = await r.json();
  ok(st.news && st.news.store.hours >= 1 && st.news.cal.eventDays === 1, 'local: /status reports news + calendar');
  console.log('\n' + n + ' checks passed (with the local round trip)');
}
