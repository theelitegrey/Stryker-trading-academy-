// TradeZoro news + economic calendar store (InsightSentry, commercial licence; Owner approved
// 2026-10-14). Pure helpers shared by the Worker (src/index.js), the tests and, by copy, the
// server feeder (news-feeder/news_feeder.py keeps the SAME tag rules; test/news.test.mjs checks
// the two agree on fixtures).
//
//   feeder (this server, every 2 min) -- GET /v3/newsfeed, /v3/calendar/* --> InsightSentry
//         | compact items: { id, t, s, h, m, u, r, g }   (see compactNews)
//         +--- POST /news-ingest, /cal-ingest (x-ingest-key) --->  Worker -> Durable Object
//   site (Charts News panel, News markers, Economic events, calendar page)
//         --- GET /news?sym=&q=&from=&to=, GET /cal?kind=&from=&to= (edge-cached) --->
//
// No IS key ever reaches the Worker or the browser: only the feeder talks to InsightSentry.
// Only the headline, the source, the link and a SHORT summary (<= SUMMARY_MAX chars of what IS
// sends) are kept: the panel shows title + summary and links out to the source.

export const NEWS_KEEP_S = 7 * 86400;
export const NEWS_MAX_BODY = 512 * 1024;
export const CAL_MAX_BODY = 512 * 1024;
export const SUMMARY_MAX = 280;
export const NEWS_SYMS = ['NQ', 'ES', 'YM', 'GC', 'SI', 'CL', 'BTC', 'ETH'];
export const CAL_KINDS = ['events', 'earnings', 'dividends', 'ipos'];
export const CAL_KEEP_DAYS = 70;

// ---- symbol tagging ------------------------------------------------------------------------
// IS related_symbols (exchange prefix dropped) -> our tags.
const RS = {
  NQ: ['NDX', 'NQ1!', 'MNQ1!', 'QQQ', 'NAS100', 'US100', 'IXIC', 'NQ'],
  ES: ['SPX', 'ES1!', 'MES1!', 'SPY', 'US500', 'SPX500', 'ES', 'VOO', 'IVV'],
  YM: ['DJI', 'YM1!', 'MYM1!', 'DIA', 'US30', 'YM'],
  GC: ['GC1!', 'MGC1!', 'XAUUSD', 'GOLD', 'GLD', 'IAU'],
  SI: ['SI1!', 'SIL1!', 'XAGUSD', 'SILVER', 'SLV'],
  CL: ['CL1!', 'MCL1!', 'USOIL', 'UKOIL', 'BRN1!', 'BZ1!', 'WTI', 'USO', 'BRENT'],
  BTC: ['BTCUSD', 'BTCUSDT', 'BTC', 'IBIT', 'GBTC', 'FBTC', 'BTCUSDC', 'XBTUSD'],
  ETH: ['ETHUSD', 'ETHUSDT', 'ETH', 'ETHA', 'ETHE', 'ETHUSDC']
};
// The biggest index weights: news on them moves NQ / ES (and the Dow for its members).
const MEGA = ['AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'GOOG', 'META', 'TSLA', 'AVGO', 'NFLX', 'AMD', 'COST', 'PLTR'];
// Mega-caps that are also big Dow weights.
const DOW = ['MSFT', 'AAPL', 'AMZN', 'NVDA', 'GS', 'UNH', 'HD', 'CAT'];
// A story about many companies (fund holdings, ETF flows, sector round-ups) is not about one of
// them: single-stock tags only count when IS lists at most this many related symbols.
const MAX_RELATED_FOR_STOCK = 3;
const MAX_RELATED_BASKET = 6;
RS.ES.push('DJX'); RS.YM.push('DJX');
const RS_MAP = new Map();
for (const [tag, list] of Object.entries(RS)) for (const s of list) RS_MAP.set(s, (RS_MAP.get(s) || []).concat(tag));
// Title keyword rules (case-insensitive, whole words). MACRO / CRYPTO / STOCKS are extra tags
// that a symbol's feed also includes (see feedTags).
const KW = [
  ['NQ', /\b(nasdaq(?![- ]listed)|nasdaq[- ]100|tech stocks?|tech shares)\b/i],
  ['ES', /\b(s&p\s?500|s&p(?! global)|wall street|us stocks?|u\.s\. stocks?|stock market|stocks? futures|equity futures)\b/i],
  ['YM', /\b(the dow|dow jones industrial|dow futures|dow industrials|dow (?:jones )?(?:average|index))\b/i],
  ['GC', /\b(gold(?! fields| mine| miner| reserve corp)|bullion|precious metals?)\b/i],
  ['SI', /\b(silver|precious metals?)\b/i],
  ['CL', /\b(crude|oil prices?|oil futures|oil market|brent|wti|opec\+?|oil (?:rises|falls|jumps|slips|gains|drops|steadies|climbs|edges|extends|rebounds|eases|slides|tumbles|surges))\b/i],
  ['BTC', /\b(bitcoin|btc)\b/i],
  ['ETH', /\b(ethereum|ether|eth)\b/i],
  ['CRYPTO', /\b(crypto(?:currenc(?:y|ies))?|stablecoins?|solana|xrp|binance|coinbase|digital assets?)\b/i],
  ['MACRO', /\b(fed|fomc|federal reserve|powell|warsh|cpi|inflation|pce|payrolls?|nfp|jobless claims|unemployment|gdp|treasury yields?|yields?|treasur(?:y|ies)|rate (?:cut|hike)s?|interest rates?|ppi|retail sales|ism|jobs report|recession|tariffs?|ecb|boj|bank of england|central bank|fiscal|debt ceiling|shutdown)\b/i]
];
// Analyst-rating and press-release noise: kept only when it is about one of our tags.
const NOISE = /\b(price target|is maintained at|initiates coverage|reiterate[sd]?|raised to (?:buy|hold|sell|overweight|outperform|neutral)|cut to (?:buy|hold|sell|underweight|neutral)|downgraded|upgraded|monthly update|announces (?:preliminary|quarterly|dividend)|declares (?:quarterly )?dividend)\b/i;
// Market-wide desks: their untagged headlines still go into "All markets".
const GENERAL = new Set(['reuters', 'financial juice', 'dow jones newswires', 'marketwatch', 'trading economics', 'mace news', 'cme group',
  'cnbc', 'dpa-afx', 'barchart', 'cointelegraph', 'the block', 'beincrypto', 'crypto briefing', 'trumps truth social posts', 'investinglive',
  'dailyfx', 'zawya', 'seeking alpha', 'stocktwits', 'benzinga']);

export function parseRelated(v) {
  if (Array.isArray(v)) return v.map(String);
  const s = String(v || '');
  const out = [];
  const re = /'([^']{1,60})'|"([^"]{1,60})"/g;
  let m;
  while ((m = re.exec(s))) out.push(m[1] || m[2]);
  if (!out.length && s && !/[\[\]'"]/.test(s)) s.split(/[,\s]+/).forEach((x) => { if (x) out.push(x); });
  return out;
}
const bare = (s) => String(s).split(':').pop().toUpperCase();

// Tags for one item: our symbols from IS related symbols + title keywords.
export function tagNews(title, related) {
  const g = new Set();
  const nRel = (related || []).length;
  const few = nRel <= MAX_RELATED_FOR_STOCK;
  for (const r of related || []) {
    const b = bare(r);
    // a wide basket (some desks attach SPX, DJI, VIX, oil, EURUSD... to every macro flash) says
    // "market-wide", not "this is about oil": MACRO instead of the per-symbol tags
    if (RS_MAP.has(b)) { if (nRel > MAX_RELATED_BASKET) g.add('MACRO'); else RS_MAP.get(b).forEach((t) => g.add(t)); }
    if (few && MEGA.includes(b)) { g.add('NQ'); g.add('ES'); g.add('STOCKS'); }
    if (few && DOW.includes(b)) g.add('YM');
  }
  const t = String(title || '');
  for (const [tag, re] of KW) if (re.test(t)) g.add(tag);
  if (g.has('BTC') || g.has('ETH')) g.add('CRYPTO');
  return [...g].sort();
}

// The tags a symbol's feed shows: its own, plus the macro news that moves it.
export function feedTags(sym) {
  sym = String(sym || '').toUpperCase();
  if (!NEWS_SYMS.includes(sym)) return null;
  if (sym === 'BTC' || sym === 'ETH') return [sym, 'CRYPTO'];
  if (sym === 'CL') return ['CL'];
  return [sym, 'MACRO'];
}

export function normTitle(t) {
  return String(t || '').toLowerCase().replace(/&amp;/g, '&').replace(/[^a-z0-9]+/g, ' ').trim();
}
// FNV-1a 32-bit over the normalised title: the same story re-sent (or sent by two desks with the
// same headline) collapses to one id.
export function newsId(title) {
  const s = normTitle(title);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(36);
}

export function cleanSummary(content, title) {
  let s = String(content || '').replace(/\*\*|__|\\n/g, ' ').replace(/https?:\/\/\S+/g, '').replace(/\s+/g, ' ').trim();
  if (!s) return '';
  // drop a summary that only repeats the title
  if (normTitle(s).startsWith(normTitle(title)) && s.length <= String(title || '').length + 8) return '';
  if (s.length > SUMMARY_MAX) { s = s.slice(0, SUMMARY_MAX); const k = s.lastIndexOf(' '); s = (k > SUMMARY_MAX * 0.6 ? s.slice(0, k) : s).replace(/[,;:.\s]+$/, '') + '…'; }
  return s;
}

// One raw IS newsfeed item -> our compact item, or null when it is dropped (no title / time,
// rating noise not about our markets, untagged item from a non-market desk).
export function compactNews(it) {
  const title = String(it && it.title || '').replace(/\s+/g, ' ').trim().slice(0, 300);
  const t = Math.floor(Number(it && it.published_at));
  if (!title || !(t > 1e9)) return null;
  const related = parseRelated(it.related_symbols).slice(0, 12);
  const g = tagNews(title, related);
  const src = String(it.source || '').trim().slice(0, 60);
  const ours = g.some((x) => NEWS_SYMS.includes(x) || x === 'MACRO' || x === 'CRYPTO');
  if (NOISE.test(title) && !g.some((x) => NEWS_SYMS.includes(x))) return null;
  if (!ours && !GENERAL.has(src.toLowerCase())) return null;
  const out = { id: newsId(title), t, s: src, h: title, g };
  const m = cleanSummary(it.content, title);
  if (m) out.m = m;
  const u = String(it.link || '');
  if (/^https:\/\/[^\s"<>]{4,400}$/.test(u)) out.u = u;
  if (related.length) out.r = related.slice(0, 8).map(bare);
  return out;
}

// ---- ingest validation (Worker side; the feeder already compacted) ---------------------------
export function validateNewsItems(list, nowSec) {
  if (!Array.isArray(list) || !list.length || list.length > 2000) return { error: 'items: 1-2000' };
  const out = [];
  for (const x of list) {
    if (!x || typeof x !== 'object') return { error: 'bad item' };
    if (typeof x.id !== 'string' || !/^[a-z0-9]{1,10}$/.test(x.id)) return { error: 'bad id' };
    if (!Number.isInteger(x.t) || x.t > nowSec + 600 || x.t < nowSec - NEWS_KEEP_S - 86400) return { error: 'bad t ' + x.t };
    if (typeof x.h !== 'string' || !x.h || x.h.length > 300) return { error: 'bad title' };
    if (x.m != null && (typeof x.m !== 'string' || x.m.length > SUMMARY_MAX + 2)) return { error: 'bad summary' };
    if (x.u != null && (typeof x.u !== 'string' || !/^https:\/\//.test(x.u) || x.u.length > 400)) return { error: 'bad link' };
    if (!Array.isArray(x.g) || x.g.length > 12 || x.g.some((v) => typeof v !== 'string' || v.length > 8)) return { error: 'bad tags' };
    const c = { id: x.id, t: x.t, s: String(x.s || '').slice(0, 60), h: x.h, g: x.g };
    if (x.m) c.m = x.m;
    if (x.u) c.u = x.u;
    if (Array.isArray(x.r)) c.r = x.r.slice(0, 8).map((v) => String(v).slice(0, 24));
    out.push(c);
  }
  return { items: out };
}

// Merge into a Map id -> item. Same id: keep the EARLIEST time (first print), fill a missing
// link / summary from the later copy. Returns the hour buckets (t / 3600) that changed.
export function mergeNews(map, items) {
  const touched = new Set();
  for (const x of items) {
    const old = map.get(x.id);
    if (!old) { map.set(x.id, x); touched.add(Math.floor(x.t / 3600)); continue; }
    let ch = false;
    if (x.t < old.t) { touched.add(Math.floor(old.t / 3600)); old.t = x.t; ch = true; }
    if (!old.u && x.u) { old.u = x.u; ch = true; }
    if (!old.m && x.m) { old.m = x.m; ch = true; }
    const g = new Set(old.g.concat(x.g));
    if (g.size !== old.g.length) { old.g = [...g].sort(); ch = true; }
    if (ch) touched.add(Math.floor(old.t / 3600));
  }
  return touched;
}

// Query: newest first. sym = one of NEWS_SYMS (its feed tags) or '' = all markets; q = words that
// must all appear in the title / summary / source; [from, to] epoch seconds; to also acts as the
// bar-replay cut-off (nothing after it is ever returned).
export function queryNews(items, o) {
  const tags = o.sym ? feedTags(o.sym) : null;
  if (o.sym && !tags) return [];
  const words = String(o.q || '').toLowerCase().split(/\s+/).filter((w) => w.length >= 2).slice(0, 6);
  const from = Number(o.from) || 0, to = Number(o.to) || Infinity, limit = Math.max(1, Math.min(500, Number(o.limit) || 100));
  const out = [];
  for (const x of items) {
    if (x.t < from || x.t > to) continue;
    if (tags && !x.g.some((g) => tags.includes(g))) continue;
    if (words.length) {
      const hay = (x.h + ' ' + (x.m || '') + ' ' + x.s + ' ' + (x.r || []).join(' ')).toLowerCase();
      if (!words.every((w) => hay.includes(w))) continue;
    }
    out.push(x);
  }
  out.sort((a, b) => b.t - a.t);
  return out.slice(0, limit);
}

// ---- calendar ------------------------------------------------------------------------------
const IMP = ['high', 'medium', 'low'];
// One raw IS economic event -> compact. t = epoch ms.
export function compactEvent(e) {
  const t = Date.parse(e && e.date);
  const title = String(e && e.title || '').trim().slice(0, 140);
  if (!Number.isFinite(t) || !title) return null;
  const holiday = /holiday/i.test(String(e.type || ''));
  const num = (v) => (v === null || v === undefined || v === '' ? null : (Number.isFinite(Number(v)) ? Number(v) : String(v).slice(0, 24)));
  const out = { t, c: String(e.country || '').slice(0, 3).toUpperCase(), cur: String(e.currency || '').slice(0, 4).toUpperCase(),
    i: holiday ? 'holiday' : (IMP.includes(e.importance) ? e.importance : 'low'), ti: title, ty: String(e.type || '').slice(0, 80) };
  const a = num(e.actual), f = num(e.forecast), p = num(e.previous);
  if (a !== null) out.a = a;
  if (f !== null) out.f = f;
  if (p !== null) out.p = p;
  if (e.unit) out.u = String(e.unit).slice(0, 8);
  if (e.scale) out.sc = String(e.scale).slice(0, 4);
  return out;
}
export function validateCal(kind, body, nowMs) {
  if (!CAL_KINDS.includes(kind)) return { error: 'bad kind' };
  if (!body || !Array.isArray(body.items) || body.items.length > 6000) return { error: 'items' };
  if (kind === 'events') {
    const days = body.days;
    if (!Array.isArray(days) || !days.length || days.length > 45 || days.some((d) => !/^\d{4}-\d{2}-\d{2}$/.test(d))) return { error: 'days' };
    for (const e of body.items) {
      if (!e || !Number.isFinite(e.t) || typeof e.ti !== 'string' || !e.ti || e.ti.length > 140) return { error: 'bad event' };
      if (!['high', 'medium', 'low', 'holiday'].includes(e.i)) return { error: 'bad importance' };
      if (!days.includes(new Date(e.t).toISOString().slice(0, 10))) return { error: 'event outside days' };
    }
  } else {
    for (const e of body.items) if (!e || typeof e.code !== 'string' || e.code.length > 40 || !Number.isFinite(e.t)) return { error: 'bad row' };
  }
  if (!Number.isFinite(body.fetched_at) || Math.abs(nowMs - body.fetched_at) > 30 * 60000) return { error: 'stale' };
  return { ok: true };
}
// Events of the days [from, to] (YYYY-MM-DD, at most 45 days), sorted by time.
export function calRange(fromQ, toQ, nowMs) {
  const day = (ms) => new Date(ms).toISOString().slice(0, 10);
  const ok = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) && Number.isFinite(Date.parse(s + 'T00:00:00Z'));
  let from = ok(fromQ) ? fromQ : day(nowMs - 7 * 86400000);
  let to = ok(toQ) ? toQ : day(nowMs + 14 * 86400000);
  const f = Date.parse(from + 'T00:00:00Z'), t = Date.parse(to + 'T00:00:00Z');
  if (t < f) return null;
  if (t - f > 44 * 86400000) to = day(f + 44 * 86400000);
  return { from, to };
}
export function daysBetween(from, to) {
  const out = [];
  for (let t = Date.parse(from + 'T00:00:00Z'); t <= Date.parse(to + 'T00:00:00Z'); t += 86400000) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

// ---- Durable Object storage (called from BookRecorder in src/index.js) -----------------------
// News: one row per UTC hour (h = t / 3600) holding that hour's items as JSON, so a 7-day query
// reads at most 169 rows and an ingest rewrites only the hours it touched. Dedupe is across the
// whole 7 days (the ingest loads every hour once; ~170 rows read per 2-min ingest).
// Calendar: events one row per UTC day (days the feeder fetched are replaced whole, so a
// cancelled event disappears); earnings / dividends / IPOs one blob per kind (latest only).
export function storeInit(sql) {
  sql.exec('CREATE TABLE IF NOT EXISTS newsh (h INTEGER PRIMARY KEY, j TEXT NOT NULL)');
  sql.exec('CREATE TABLE IF NOT EXISTS calday (day TEXT PRIMARY KEY, ts INTEGER NOT NULL, j TEXT NOT NULL) WITHOUT ROWID');
  sql.exec('CREATE TABLE IF NOT EXISTS calx (kind TEXT PRIMARY KEY, ts INTEGER NOT NULL, j TEXT NOT NULL) WITHOUT ROWID');
}
export function storeNewsIngest(sql, items, nowSec) {
  const cut = Math.floor((nowSec - NEWS_KEEP_S) / 3600);
  const map = new Map();
  const rows = sql.exec('SELECT h, j FROM newsh WHERE h >= ?', cut).toArray();
  for (const r of rows) for (const x of JSON.parse(r.j)) map.set(x.id, x);
  const before = map.size;
  const touched = mergeNews(map, items.filter((x) => x.t >= nowSec - NEWS_KEEP_S));
  if (touched.size) {
    const byH = new Map();
    for (const x of map.values()) { const h = Math.floor(x.t / 3600); if (touched.has(h)) { if (!byH.has(h)) byH.set(h, []); byH.get(h).push(x); } }
    for (const h of touched) {
      const list = (byH.get(h) || []).sort((a, b) => b.t - a.t);
      if (list.length) sql.exec('INSERT OR REPLACE INTO newsh (h, j) VALUES (?, ?)', h, JSON.stringify(list));
      else sql.exec('DELETE FROM newsh WHERE h = ?', h);
    }
  }
  sql.exec('DELETE FROM newsh WHERE h < ?', cut);
  return { added: map.size - before, hours: touched.size, total: map.size };
}
export function storeNewsRead(sql, fromSec, toSec) {
  const out = [];
  const rows = sql.exec('SELECT j FROM newsh WHERE h >= ? AND h <= ? ORDER BY h DESC', Math.floor(fromSec / 3600), Math.floor(toSec / 3600)).toArray();
  for (const r of rows) for (const x of JSON.parse(r.j)) out.push(x);
  return out;
}
export function storeNewsStats(sql) {
  const r = sql.exec('SELECT COUNT(*) AS hours, MIN(h) AS h0, MAX(h) AS h1, SUM(LENGTH(j)) AS b FROM newsh').toArray()[0];
  return { hours: r.hours, from: r.h0 ? r.h0 * 3600 : null, to: r.h1 ? r.h1 * 3600 + 3599 : null, bytes: r.b || 0 };
}
export function storeCalIngest(sql, kind, body, nowMs) {
  if (kind === 'events') {
    const by = new Map(body.days.map((d) => [d, []]));
    for (const e of body.items) by.get(new Date(e.t).toISOString().slice(0, 10)).push(e);
    for (const [d, list] of by) sql.exec('INSERT OR REPLACE INTO calday (day, ts, j) VALUES (?, ?, ?)', d, body.fetched_at, JSON.stringify(list.sort((a, b) => a.t - b.t)));
    sql.exec('DELETE FROM calday WHERE day < ?', new Date(nowMs - 400 * 86400000).toISOString().slice(0, 10));
    return body.days.length;
  }
  sql.exec('INSERT OR REPLACE INTO calx (kind, ts, j) VALUES (?, ?, ?)', kind, body.fetched_at, JSON.stringify(body.items));
  return body.items.length;
}
export function storeCalRead(sql, kind, from, to) {
  if (kind === 'events') {
    const rows = sql.exec('SELECT day, ts, j FROM calday WHERE day >= ? AND day <= ? ORDER BY day', from, to).toArray();
    const items = [];
    let ts = 0;
    for (const r of rows) { ts = Math.max(ts, r.ts); for (const e of JSON.parse(r.j)) items.push(e); }
    return { kind, from, to, days: rows.map((r) => r.day), updated: ts || null, items };
  }
  const r = sql.exec('SELECT ts, j FROM calx WHERE kind = ?', kind).toArray()[0];
  return { kind, updated: r ? r.ts : null, items: r ? JSON.parse(r.j) : [] };
}
export function storeCalStats(sql) {
  const d = sql.exec('SELECT COUNT(*) AS n, MIN(day) AS d0, MAX(day) AS d1, MAX(ts) AS ts FROM calday').toArray()[0];
  const x = sql.exec('SELECT kind, ts, LENGTH(j) AS b FROM calx').toArray();
  return { eventDays: d.n, from: d.d0, to: d.d1, updated: d.ts, other: x };
}
