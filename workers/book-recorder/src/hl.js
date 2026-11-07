// Hyperliquid wallet intel ("who moved the market"), free for everyone. Owner order 2026-11-07.
// Feeder: hl-feeder/hl_feeder.py on our server (public Hyperliquid WS + info API, no key) POSTs gzip JSON to
// /hl-ingest?kind=min|state|labels with the shared ingest secret. The Durable Object validates and stores:
//   hlmin   one row per finished minute, ALL coins (gzip JSON as it came: per coin the top 100 wallets + "others")
//   hlhour  one row per coin per hour, rolled up here from the minutes when the hour is complete (top 300 + others)
//   hlblob  the latest 'state' (tracked wallets: clusters, book levels, profiles) and 'labels' (gzip JSON)
// Kept 7 days (3 if the store passes 1 GB: hlGuard). Writes stay small for the free plan: ~1,440 minute rows + ~4,300 hour rows + 288 state rows a day,
// and the same again as trims.
// Public reads (GET, our origins, per-IP limit RL_HL 60/min, edge-cached):
//   /hl-candle?coin=&from=&to=[&n=]   /hl-clusters?coin=   /hl-level?coin=&lo=&hi=[&side=]   /hl-wallet?a=   /hl-meta
// Shapes: stryker-notes/reports/workers/hl-intel/contract.md. Public market data only (addresses are public on-chain).
// Labels are only public names (leaderboard display name, vault name) or our size tags, never guessed.

export const HL_MAX_BODY = 1024 * 1024;
export const HL_KEEP_MS = 7 * 86400000;
// Storage guard: the wallet-intel tables (~350 MB at 7 days) share the DO's storage with the book recorder. Measured every
// 6 h; past 1 GB the store keeps 3 days instead of 7, and goes back to 7 once 7 days would fit under 0.8 GB again.
export const HL_GUARD_BYTES = 1e9, HL_KEEP_SHORT_MS = 3 * 86400000;
export function hlKeepFor(bytes, cur) {
  if (bytes > HL_GUARD_BYTES) return HL_KEEP_SHORT_MS;
  if (cur === HL_KEEP_SHORT_MS && bytes * (HL_KEEP_MS / HL_KEEP_SHORT_MS) < 0.8 * HL_GUARD_BYTES) return HL_KEEP_MS;
  return cur === HL_KEEP_SHORT_MS ? cur : HL_KEEP_MS;
}
const keepOf = (self) => Number(self.meta('hlKeepMs')) || HL_KEEP_MS;
// bytes held by the hl tables (length() of a BLOB/TEXT reads the row header, not the payload). ~40k rows read.
export function hlBytes(sql) {
  const q = (t) => Number((sql.exec(t).toArray()[0] || {}).b) || 0;
  return q('SELECT SUM(length(gz)) AS b FROM hlmin') + q('SELECT SUM(length(j)) AS b FROM hlhour') + q('SELECT SUM(length(gz)) AS b FROM hlblob');
}
export function hlGuard(self, now) {
  const bytes = hlBytes(self.sql), was = keepOf(self), keep = hlKeepFor(bytes, was);
  self.meta('hlBytes', String(bytes)); self.meta('hlGuardT', String(now));
  if (keep !== was) {
    self.meta('hlKeepMs', String(keep));
    console.warn('hl-intel storage guard: ' + Math.round(bytes / 1e6) + ' MB, keep ' + (was / 86400000) + ' -> ' + (keep / 86400000) + ' days');
    if (keep < was) {
      self.sql.exec('DELETE FROM hlmin WHERE t < ?', now - keep);
      self.sql.exec('DELETE FROM hlhour WHERE t < ?', Math.floor((now - keep) / HOUR) * HOUR);
    }
  }
  return { bytes, keep };
}
const MIN = 60000, HOUR = 3600000;
const MIN_TOP = 100, HOUR_TOP = 300;
const ADDR = /^0x[0-9a-f]{40}$/;
const COIN = /^(@\d{1,5}|[A-Za-z0-9]{1,16}(:[A-Za-z0-9]{1,16})?)$/;
const TAGS = new Set(['whale', 'top100vol', 'vault']);
const fin = (x) => typeof x === 'number' && Number.isFinite(x);
const json = (o, status, headers) => new Response(JSON.stringify(o), { status: status || 200, headers: Object.assign({ 'content-type': 'application/json; charset=utf-8' }, headers || {}) });

export function shortId(a) { return typeof a === 'string' && a.length > 10 ? a.slice(0, 6) + '\u2026' + a.slice(-2) : String(a); }

async function gunzipText(buf, max) {
  const ds = new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip')));
  const text = await ds.text();
  if (text.length > max) throw new Error('too big unpacked');
  return text;
}
async function gzipBytes(text) {
  return new Uint8Array(await new Response(new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
}

// ---- validation (pure) -------------------------------------------------------------------------
function rowsOk(rows, nw) {
  if (!Array.isArray(rows) || rows.length > 2000) return false;
  for (const r of rows) {
    if (!Array.isArray(r) || r.length !== 8 || !r.every(fin)) return false;
    if (!(Number.isInteger(r[0]) && r[0] >= -1 && r[0] < nw)) return false;
    for (let i = 1; i < 8; i++) if (r[i] < 0) return false;
  }
  return true;
}
const totOk = (t) => Array.isArray(t) && t.length === 5 && t.every((x) => fin(x) && x >= 0);

export function validateMinute(d, now) {
  if (!d || d.v !== 1 || !fin(d.t) || d.t % MIN !== 0) return 'bad header';
  if (d.t > now || d.t < now - HL_KEEP_MS) return 'stale or future t';
  if (!Array.isArray(d.w) || d.w.length > 50000 || !d.w.every((a) => typeof a === 'string' && ADDR.test(a))) return 'bad wallets';
  const cs = Object.keys(d.c || {});
  if (cs.length > 600) return 'bad coins';
  for (const c of cs) {
    if (!COIN.test(c)) return 'bad coin';
    const x = d.c[c];
    if (!x || !totOk(x.tot) || !rowsOk(x.r, d.w.length)) return 'bad rows ' + c;
  }
  if (d.spot && (typeof d.spot !== 'object' || Object.keys(d.spot).length > 600)) return 'bad spot';
  return '';
}

function sideOk(v) { return v === undefined || (Array.isArray(v) && v.length === 2 && v.every(fin)); }
function bucketsOk(arr) {
  if (!Array.isArray(arr) || arr.length > 1000) return false;
  for (const b of arr) {
    if (!b || !fin(b.px) || !Array.isArray(b.w) || b.w.length > 50) return false;
    if (!['long', 'short', 'buy', 'sell'].every((k) => sideOk(b[k]))) return false;
    if (!b.w.every((w) => w && ADDR.test(w.a) && fin(w.ntl))) return false;
  }
  return true;
}
export function validateState(d, now) {
  if (!d || d.v !== 1 || !fin(d.t) || d.t > now + 60000 || d.t < now - 30 * MIN) return 'stale or bad header';
  const cs = Object.keys(d.coins || {});
  if (cs.length > 600) return 'bad coins';
  for (const c of cs) {
    const x = d.coins[c];
    if (!COIN.test(c) || !x || x.coin !== c || !fin(x.mid) || !fin(x.step) || x.step <= 0) return 'bad coin ' + c;
    if (!bucketsOk(x.liq) || !bucketsOk(x.stops)) return 'bad buckets ' + c;
    if (!Array.isArray(x.levels) || x.levels.length > 20000) return 'bad levels ' + c;
    for (const l of x.levels) {
      if (!Array.isArray(l) || !fin(l[0]) || (l[1] !== 'bid' && l[1] !== 'ask') || !Array.isArray(l[2])) return 'bad level ' + c;
      if (!l[2].every((w) => Array.isArray(w) && ADDR.test(w[0]) && fin(w[1]))) return 'bad level wallet ' + c;
    }
    if (x.liqEvents && (!Array.isArray(x.liqEvents) || x.liqEvents.length > 100)) return 'bad events ' + c;
  }
  const ws = Object.keys(d.wallets || {});
  if (ws.length > 20000 || !ws.every((a) => ADDR.test(a))) return 'bad wallets';
  return '';
}
export function validateLabels(d, now) {
  if (!d || d.v !== 1 || !fin(d.t) || d.t > now + 60000 || d.t < now - 3 * HOUR) return 'stale or bad header';
  const ks = Object.keys(d.labels || {});
  if (ks.length > 50000) return 'too many';
  for (const k of ks) {
    const e = d.labels[k];
    if (!ADDR.test(k) || !e || !(e.name === null || (typeof e.name === 'string' && e.name.length <= 40))) return 'bad label';
    if (!Array.isArray(e.tags) || !e.tags.every((t) => TAGS.has(t))) return 'bad tags';
  }
  return '';
}
const VALIDATE = { min: validateMinute, state: validateState, labels: validateLabels };

// ---- merging (pure) ----------------------------------------------------------------------------
// acc: Map addr -> [buySz, buyNtl, sellSz, sellNtl, fills, takerBuyNtl, takerSellNtl]; '_others' = the summed tail.
export function mergeCoin(acc, tot, w, x) {
  for (let i = 0; i < 5; i++) tot[i] += x.tot[i];
  for (const r of x.r) {
    const k = r[0] >= 0 ? w[r[0]] : '_others';
    let v = acc.get(k);
    if (!v) { v = [0, 0, 0, 0, 0, 0, 0]; acc.set(k, v); }
    for (let i = 0; i < 7; i++) v[i] += r[i + 1];
  }
}
// -> { w, tot, r } with the top `top` wallets; the tail summed into one row with index -1.
export function packCoin(acc, tot, top) {
  const items = [...acc.entries()].filter(([k]) => k !== '_others').sort((a, b) => (b[1][1] + b[1][3]) - (a[1][1] + a[1][3]));
  let rest = acc.get('_others') ? acc.get('_others').slice() : null;
  for (const [, v] of items.slice(top)) { rest = rest || [0, 0, 0, 0, 0, 0, 0]; for (let i = 0; i < 7; i++) rest[i] += v[i]; }
  const keep = items.slice(0, top), w = keep.map(([k]) => k);
  const r = keep.map(([, v], i) => [i, ...v]);
  if (rest) r.push([-1, ...rest]);
  return { w, tot: tot.slice(), r };
}

const rnd = (x, n) => (x === null ? null : Math.round(x * 10 ** n) / 10 ** n);
export function decorate(a, labels) {
  const e = labels && labels[a];
  return { l: (e && e.name) || shortId(a), tags: (e && e.tags) || [] };
}
// Merged acc + tot -> the /hl-candle body.
export function candleBody(coin, from, to, acc, tot, n, labels, span) {
  const items = [...acc.entries()].filter(([k]) => k !== '_others').sort((a, b) => (b[1][1] + b[1][3]) - (a[1][1] + a[1][3]));
  const o = acc.get('_others');
  const wallets = items.slice(0, n).map(([a, v]) => Object.assign({ a }, decorate(a, labels), {
    buySz: rnd(v[0], 8), buyNtl: rnd(v[1], 2), sellSz: rnd(v[2], 8), sellNtl: rnd(v[3], 2), fills: v[4],
    takerBuyNtl: rnd(v[5], 2), takerSellNtl: rnd(v[6], 2),
    buyAvgPx: v[0] > 0 ? rnd(v[1] / v[0], 8) : null, sellAvgPx: v[2] > 0 ? rnd(v[3] / v[2], 8) : null,
    netSz: rnd(v[0] - v[2], 8), pct: tot[2] > 0 ? rnd(100 * (v[1] + v[3]) / tot[2], 1) : 0
  }));
  let others = null;
  const tail = items.slice(n);
  if (o || tail.length) {
    const s = o ? o.slice() : [0, 0, 0, 0, 0, 0, 0];
    for (const [, v] of tail) for (let i = 0; i < 7; i++) s[i] += v[i];
    others = { buySz: rnd(s[0], 8), buyNtl: rnd(s[1], 2), sellSz: rnd(s[2], 8), sellNtl: rnd(s[3], 2), fills: s[4], takerBuyNtl: rnd(s[5], 2), takerSellNtl: rnd(s[6], 2) };
  }
  return {
    v: 1, coin, from, to, updated: span.updated, held: span.held, partial: !(span.held && from >= span.held && to <= span.updated + MIN),
    tot: { trades: tot[0], sz: rnd(tot[1], 8), ntl: rnd(tot[2], 2), takerBuyNtl: rnd(tot[3], 2), takerSellNtl: rnd(tot[4], 2), wallets: items.length, truncated: !!o },
    wallets, others
  };
}

// /hl-candle query -> { coin, from, to, n, hourly } | null. Pure.
export function candleQuery(u, now) {
  const coin = String(u.searchParams.get('coin') || '');
  if (!COIN.test(coin)) return null;
  let from = Number(u.searchParams.get('from')), to = Number(u.searchParams.get('to'));
  if (!fin(from) || !fin(to)) return null;
  if (from < 1e11) from *= 1000;   // seconds accepted too
  if (to < 1e11) to *= 1000;
  from = Math.floor(from / MIN) * MIN;
  to = Math.ceil(to / MIN) * MIN;
  if (!(to > from) || to - from > HL_KEEP_MS || to > now + 2 * MIN || from < now - HL_KEEP_MS - HOUR) return null;
  const hourly = to - from >= HOUR;
  if (hourly) { from = Math.floor(from / HOUR) * HOUR; to = Math.ceil(to / HOUR) * HOUR; }
  const n = Math.min(100, Math.max(1, Math.floor(Number(u.searchParams.get('n')) || 25)));
  return { coin, from, to, n, hourly };
}

// clusters -> labelled copy (pure)
export function clustersBody(x, labels) {
  const dec = (b) => Object.assign({}, b, { w: b.w.map((w) => Object.assign({}, w, decorate(w.a, labels))) });
  return {
    v: 1, coin: x.coin, t: x.t, mid: x.mid, step: x.step, coverage: x.coverage,
    liq: x.liq.map(dec), stops: x.stops.map(dec),
    liqEvents: (x.liqEvents || []).map((e) => Object.assign({}, e, { l: decorate(e.user, labels).l }))
  };
}
export function levelBody(x, lo, hi, side, labels) {
  const levels = [];
  let totSz = 0, totNtl = 0;
  for (const [px, s, ws] of x.levels) {
    if (px < lo || px > hi || (side && s !== side)) continue;
    const w = ws.map(([a, sz]) => Object.assign({ a }, decorate(a, labels), { sz, ntl: rnd(sz * px, 2) }));
    for (const r of w) { totSz += r.sz; totNtl += r.ntl; }
    levels.push({ px, side: s, w });
  }
  return { v: 1, coin: x.coin, t: x.t, lo, hi, levels, totSz: rnd(totSz, 8), totNtl: rnd(totNtl, 2), coverage: { bookPct: x.coverage.bookPct ?? null, wallets: x.coverage.wallets } };
}
export function walletBody(a, st, labels) {
  const p = (st && st.wallets && st.wallets[a]) || {};
  const e = labels && labels[a];
  return Object.assign({ v: 1, a }, decorate(a, labels), {
    tracked: !!p.tracked, av: p.av ?? (e ? e.av : null) ?? null, vol30: e ? e.vol30 ?? null : null, t: p.t || null,
    pos: p.pos || [], trig: p.trig || [], nLim: p.nLim || 0, fills: p.fills || []
  });
}

// ---- Durable Object side ----------------------------------------------------------------------
export function hlInit(sql) {
  sql.exec('CREATE TABLE IF NOT EXISTS hlmin (t INTEGER PRIMARY KEY, gz BLOB NOT NULL)');
  sql.exec('CREATE TABLE IF NOT EXISTS hlhour (coin TEXT NOT NULL, t INTEGER NOT NULL, j TEXT NOT NULL, PRIMARY KEY (coin, t)) WITHOUT ROWID');
  sql.exec('CREATE TABLE IF NOT EXISTS hlblob (k TEXT PRIMARY KEY, t INTEGER NOT NULL, gz BLOB NOT NULL) WITHOUT ROWID');
}

async function blob(self, k) {
  self.hlMemo = self.hlMemo || {};
  const r = self.sql.exec('SELECT t, gz FROM hlblob WHERE k = ?', k).toArray()[0];
  if (!r) return null;
  const m = self.hlMemo[k];
  if (m && m.t === r.t) return m.d;
  const d = JSON.parse(await gunzipText(r.gz, 32 * 1024 * 1024));
  self.hlMemo[k] = { t: r.t, d };
  return d;
}
async function minutes(self, from, to) {
  const out = [];
  for (const r of self.sql.exec('SELECT t, gz FROM hlmin WHERE t >= ? AND t < ? ORDER BY t', from, to).toArray()) out.push(JSON.parse(await gunzipText(r.gz, 16 * 1024 * 1024)));
  return out;
}
function span(self) {
  const r = self.sql.exec('SELECT MIN(t) AS lo, MAX(t) AS hi FROM hlmin').toArray()[0] || {};
  return { held: r.lo || 0, updated: r.hi || 0 };
}

// Roll the minutes of hour h into per-coin hour rows (replaces any earlier roll-up of that hour).
export async function rollHour(self, h) {
  const ms = await minutes(self, h, h + HOUR);
  const per = new Map();
  for (const d of ms) for (const [c, x] of Object.entries(d.c)) {
    let e = per.get(c);
    if (!e) { e = { acc: new Map(), tot: [0, 0, 0, 0, 0] }; per.set(c, e); }
    mergeCoin(e.acc, e.tot, d.w, x);
  }
  // INSERT OR REPLACE by (coin, t): a DELETE by t alone would read the whole table (its key starts with coin)
  for (const [c, e] of per) self.sql.exec('INSERT OR REPLACE INTO hlhour (coin, t, j) VALUES (?, ?, ?)', c, h, JSON.stringify(Object.assign({ n: ms.length }, packCoin(e.acc, e.tot, HOUR_TOP))));
  return per.size;
}

export async function hlDo(self, u, req) {
  const p = u.pathname, now = Date.now();
  if (p === '/hl/ingest') {
    const kind = u.searchParams.get('kind');
    const buf = await req.arrayBuffer();
    const b = new Uint8Array(buf, 0, Math.min(2, buf.byteLength));
    if (!VALIDATE[kind] || b[0] !== 0x1f || b[1] !== 0x8b) return new Response('bad kind or not gzip', { status: 400 });
    let d;
    try { d = JSON.parse(await gunzipText(buf, 32 * 1024 * 1024)); } catch (e) { return new Response('bad gzip/json', { status: 400 }); }
    const bad = VALIDATE[kind](d, now);
    if (bad) return new Response(bad, { status: 400 });
    if (kind !== 'min') {
      self.sql.exec('INSERT OR REPLACE INTO hlblob (k, t, gz) VALUES (?, ?, ?)', kind, d.t, buf);
      if (kind === 'state' && d.spot) self.sql.exec('INSERT OR REPLACE INTO hlblob (k, t, gz) VALUES (?, ?, ?)', 'spot', d.t, await gzipBytes(JSON.stringify(d.spot)));
      return new Response('stored ' + kind);
    }
    self.sql.exec('INSERT OR REPLACE INTO hlmin (t, gz) VALUES (?, ?)', d.t, buf);
    // roll up every complete hour not yet rolled (and re-roll the hour of a late minute)
    const done = Number(self.meta('hlHourDone') || 0), cur = Math.floor(d.t / HOUR) * HOUR;
    let rolled = 0;
    if (cur < done + HOUR) rolled += await rollHour(self, cur);
    else {
      const first = done ? done + HOUR : Math.max(cur - HOUR, (span(self).held && Math.floor(span(self).held / HOUR) * HOUR) || cur);
      for (let h = first; h < cur; h += HOUR) rolled += await rollHour(self, h);
      if (first < cur) {
        self.meta('hlHourDone', String(cur - HOUR));
        // trim once a day: hlhour's key starts with coin, so this reads the whole table (~30k rows)
        if ((cur / HOUR) % 24 === 0) self.sql.exec('DELETE FROM hlhour WHERE t < ?', Math.floor((now - keepOf(self)) / HOUR) * HOUR);
        if ((cur / HOUR) % 6 === 0 || !self.meta('hlGuardT')) hlGuard(self, now);
      }
    }
    self.sql.exec('DELETE FROM hlmin WHERE t < ?', now - keepOf(self));
    return new Response('stored min ' + d.t + (rolled ? ' rolled ' + rolled : ''));
  }
  if (p === '/hl/candle') {
    const q = { coin: u.searchParams.get('coin'), from: Number(u.searchParams.get('from')), to: Number(u.searchParams.get('to')), n: Number(u.searchParams.get('n')), hourly: u.searchParams.get('h') === '1' };
    const acc = new Map(), tot = [0, 0, 0, 0, 0];
    if (q.hourly) {
      for (const r of self.sql.exec('SELECT j FROM hlhour WHERE coin = ? AND t >= ? AND t < ?', q.coin, q.from, q.to).toArray()) {
        const x = JSON.parse(r.j);
        mergeCoin(acc, tot, x.w, x);
      }
      // the current hour is not rolled up yet: add its minutes
      const done = Number(self.meta('hlHourDone') || 0) + HOUR;
      if (q.to > done) for (const d of await minutes(self, Math.max(q.from, done), q.to)) if (d.c[q.coin]) mergeCoin(acc, tot, d.w, d.c[q.coin]);
    } else {
      for (const d of await minutes(self, q.from, q.to)) if (d.c[q.coin]) mergeCoin(acc, tot, d.w, d.c[q.coin]);
    }
    return json(candleBody(q.coin, q.from, q.to, acc, tot, q.n, await blob(self, 'labels').then((l) => l && l.labels), span(self)));
  }
  if (p === '/hl/clusters' || p === '/hl/level') {
    const st = await blob(self, 'state'), coin = u.searchParams.get('coin');
    const x = st && st.coins[coin];
    if (!x) return json({ error: 'no_data' }, 404);
    const labels = (await blob(self, 'labels') || {}).labels;
    if (p === '/hl/clusters') return json(clustersBody(x, labels));
    return json(levelBody(x, Number(u.searchParams.get('lo')), Number(u.searchParams.get('hi')), u.searchParams.get('side') || '', labels));
  }
  if (p === '/hl/wallet') return json(walletBody(u.searchParams.get('a'), await blob(self, 'state'), (await blob(self, 'labels') || {}).labels));
  if (p === '/hl/meta') {
    const st = await blob(self, 'state'), sp = span(self);
    const lr = self.sql.exec("SELECT t FROM hlblob WHERE k = 'labels'").toArray()[0];
    return json({ v: 1, t: st ? st.t : null, updated: sp.updated, held: sp.held, tracked: st ? st.meta.tracked : 0, polled: st ? st.meta.polled : 0,
      oiPct: st ? st.meta.oiPct : null, keepDays: keepOf(self) / 86400000, bytes: Number(self.meta('hlBytes')) || null, spot: (await blob(self, 'spot')) || {}, coins: st ? Object.keys(st.coins).sort() : [], labelsT: lr ? lr.t : null });
  }
  return new Response('not found', { status: 404 });
}

// ---- Worker side ------------------------------------------------------------------------------
export async function hlIngestRoute(req, env, u, authorized, stub) {
  if (req.method !== 'POST') return new Response('POST only', { status: 405 });
  if (!(await authorized(req, env))) return new Response('unauthorized', { status: 401 });
  const kind = u.searchParams.get('kind');
  if (!VALIDATE[kind]) return new Response('bad kind', { status: 400 });
  if (Number(req.headers.get('content-length') || 0) > HL_MAX_BODY) return new Response('too large', { status: 413 });
  const buf = await req.arrayBuffer();
  if (buf.byteLength > HL_MAX_BODY) return new Response('too large', { status: 413 });
  return stub(env).fetch('https://do/hl/ingest?kind=' + kind, { method: 'POST', body: buf });   // the DO validates (gunzip + parse is past the Worker's CPU)
}

export const HL_ROUTES = new Set(['/hl-candle', '/hl-clusters', '/hl-level', '/hl-wallet', '/hl-meta']);

// GET routes: params normalised (so viewers share cache entries) -> DO path + cache key + max-age.
export function hlPlan(u, now) {
  const p = u.pathname, bucket = (s) => Math.floor(now / (s * 1000));
  if (p === '/hl-candle') {
    const q = candleQuery(u, now);
    if (!q) return null;
    const live = q.to > now - 2 * MIN;
    const qs = 'coin=' + encodeURIComponent(q.coin) + '&from=' + q.from + '&to=' + q.to + '&n=' + q.n + (q.hourly ? '&h=1' : '');
    return { path: '/hl/candle?' + qs, key: 'candle/' + qs + (live ? '/' + bucket(30) : ''), age: live ? 30 : 3600 };
  }
  if (p === '/hl-clusters') {
    const coin = String(u.searchParams.get('coin') || '');
    return COIN.test(coin) ? { path: '/hl/clusters?coin=' + encodeURIComponent(coin), key: 'clusters/' + coin + '/' + bucket(60), age: 60 } : null;
  }
  if (p === '/hl-level') {
    const coin = String(u.searchParams.get('coin') || ''), lo = Number(u.searchParams.get('lo')), hi = Number(u.searchParams.get('hi'));
    const side = String(u.searchParams.get('side') || '');
    if (!COIN.test(coin) || !fin(lo) || !fin(hi) || !(lo > 0) || hi < lo || hi - lo > hi * 0.02 || (side && side !== 'bid' && side !== 'ask')) return null;
    const qs = 'coin=' + encodeURIComponent(coin) + '&lo=' + lo + '&hi=' + hi + (side ? '&side=' + side : '');
    return { path: '/hl/level?' + qs, key: 'level/' + qs + '/' + bucket(60), age: 60 };
  }
  if (p === '/hl-wallet') {
    const a = String(u.searchParams.get('a') || '').toLowerCase();
    return ADDR.test(a) ? { path: '/hl/wallet?a=' + a, key: 'wallet/' + a + '/' + bucket(60), age: 60 } : null;
  }
  if (p === '/hl-meta') return { path: '/hl/meta', key: 'meta/' + bucket(60), age: 60 };
  return null;
}

export async function hlRoute(req, u, env, ctx, h, stub) {
  const plan = hlPlan(u, Date.now());
  if (!plan) return new Response(JSON.stringify({ error: 'bad_request' }), { status: 400, headers: Object.assign({ 'content-type': 'application/json' }, h) });
  if (env.RL_HL) {
    try {
      const { success } = await env.RL_HL.limit({ key: req.headers.get('cf-connecting-ip') || 'anon' });
      if (!success) return new Response('slow down', { status: 429, headers: Object.assign({ 'retry-after': '60' }, h) });
    } catch (e) {}
  }
  const key = new Request('https://book-recorder.cache/hl/' + plan.key);
  let res = await caches.default.match(key);
  if (!res) {
    const dr = await stub(env).fetch('https://do' + plan.path);
    res = new Response(await dr.arrayBuffer(), { status: dr.status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=' + (dr.status === 200 ? plan.age : 30) } });
    if (dr.status === 200 || dr.status === 404) ctx.waitUntil(caches.default.put(key, res.clone()));
  }
  const out = new Response(res.body, res);
  Object.entries(h).forEach(([k, v]) => out.headers.set(k, v));
  return out;
}
