// GET /api/chart/stream/:sym?tf=1 — server-side InsightSentry WebSocket bridge (via the ONE shared hub socket).
// The browser never sees INSIGHTSENTRY_WEBSOCKET_API_KEY. Only allow-listed futures roots stream.
import { isRealtimeToken, isAdminToken, wsTokenOf } from '../_rt.js';
import { RECORDER_URL, INSIGHTSENTRY_CODES, TIMEFRAMES, SYMBOLS, normSym, normTf, aggregateHours } from '../_bars.js';

const ALLOWED_ORIGINS = new Set(['https://tradezoro.com', 'https://www.tradezoro.com', 'https://strykertrading.com', 'https://www.strykertrading.com', 'http://localhost:8000']);
const H = 3600;

function decOf(tick) { const s = String(tick); return s.includes('.') ? Math.min(s.split('.')[1].length, 6) : 0; }
function rounder(dec) { const f = Math.pow(10, dec); return (n) => Math.round(n * f) / f; }
function normStreamTf(raw) {
  const s = String(raw || '1').trim().toUpperCase();
  let m = /^(\d+)S$/.exec(s);
  if (m) {
    const n = Number(m[1]);
    return n >= 1 && n <= 59 ? s : null;
  }
  m = /^(\d+)T$/.exec(s);
  if (m) {
    const n = Number(m[1]);
    return n >= 1 && n <= 100000 ? s : null;
  }
  return normTf(s);
}
function specFor(tf) {
  let sm = /^(\d+)S$/.exec(String(tf || '').toUpperCase());
  if (sm) return { bar_type: 'second', bar_interval: Number(sm[1]), agg: 1 };
  sm = /^(\d+)T$/.exec(String(tf || '').toUpperCase());
  if (sm) return { bar_type: 'tick', bar_interval: Number(sm[1]), agg: 1 };
  const cfg = TIMEFRAMES[tf];
  if (!cfg || !cfg.step || cfg.step < 60 || cfg.step > 14400) return null;
  // ONE FEED PER SYMBOL (2026-10-29): every minute/hour timeframe is built from the symbol's single 1-minute series
  // leg (InsightSentry counts each symbol+timeframe leg as its own plan unit, probed 2026-10-29), so five symbols
  // can be live on ANY timeframe. fold = the 1m rows are folded into the timeframe's epoch bucket (same buckets as
  // /api/chart/bars: floor(t/step)*step, and aggregateHours(.., 18 ET anchor) for 2h/4h).
  return { bar_type: 'minute', bar_interval: 1, agg: cfg.agg || 1, fold: cfg.step > 60, step: cfg.step };
}
function parseBar(x, dec) {
  const t = Number(x?.time ?? x?.t ?? x?.timestamp ?? x?.bar_time ?? x?.start);
  const sec = t > 1e12 ? Math.floor(t / 1000) : t;
  const c = Number(x?.close ?? x?.c);
  // Tick rows (bar_type 'tick', tf=1T) carry only time/close/volume: one trade = a flat bar.
  const o = Number(x?.open ?? x?.o ?? c), h = Number(x?.high ?? x?.h ?? c), l = Number(x?.low ?? x?.l ?? c);
  if (!Number.isFinite(sec) || !Number.isFinite(o) || !Number.isFinite(h) || !Number.isFinite(l) || !Number.isFinite(c)) return null;
  const r = rounder(dec);
  return [Math.floor(sec), r(o), r(h), r(l), r(c), Math.round(Number(x?.volume ?? x?.v ?? 0) || 0)];
}
function barsFrom(msg, dec) {
  const pools = [msg?.data, msg?.bars, msg?.series, msg?.bar, msg];
  const out = [];
  for (const p of pools) {
    if (Array.isArray(p)) for (const x of p) { const r = parseBar(x, dec); if (r) out.push(r); }
    else { const r = parseBar(p, dec); if (r) out.push(r); }
  }
  return out;
}
// CME Globex session (closed Fri 17:00 ET -> Sun 18:00 ET, daily 17:00-18:00 ET).
function cmeOpenNow(ms = Date.now()) {
  try {
    const f = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: 'numeric', hourCycle: 'h23' }).formatToParts(new Date(ms));
    const wd = f.find((x) => x.type === 'weekday').value, h = Number(f.find((x) => x.type === 'hour').value);
    if (wd === 'Sat' || (wd === 'Fri' && h >= 17) || (wd === 'Sun' && h < 18)) return false;
    return h !== 17;
  } catch (e) { return true; }
}
function err(code, msg) { return new Response(JSON.stringify({ error: msg }), { status: code, headers: { 'content-type': 'application/json; charset=utf-8' } }); }

export async function onRequestGet(ctx) {
  const origin = ctx.request.headers.get('origin') || '';
  if (origin && !ALLOWED_ORIGINS.has(origin)) return err(403, 'origin not allowed');
  if (ctx.request.headers.get('upgrade') !== 'websocket') return err(426, 'websocket required');
  const sym = normSym(ctx.params.sym);
  const url = new URL(ctx.request.url);
  const tf = normStreamTf(url.searchParams.get('tf') || '1');
  const code = sym && INSIGHTSENTRY_CODES[sym];
  const spec = tf && specFor(tf);
  const key = ctx.env && ctx.env.INSIGHTSENTRY_WEBSOCKET_API_KEY;
  if (!key) return err(503, 'realtime feed not configured');
  if (!sym || !code) return err(404, 'symbol not streamable');
  if (!tf || !spec) return err(400, 'timeframe not streamable');

  // CME futures real time is ADMIN ONLY (Owner 2026-10-16). Refused before any upstream is opened.
  // The ID token arrives as the WebSocket subprotocol ("tz-auth", "<jwt>"), not in the URL.
  const rtTok = wsTokenOf(ctx.request);
  if (!(await isRealtimeToken(rtTok))) return err(403, 'real-time futures data is admin only; delayed data is served by /api/chart/bars');
  // Per-user live feed (Owner 2026-10-26): a member the admin switched ON (students/{uid}.liveFeed) can be switched
  // OFF again, so a NON-admin socket re-checks its entitlement every 60 s (memoised 30 s in _rt.js) and is closed
  // when it ends; once its ID token expires it is closed too, so the browser reconnects with a fresh token and is
  // re-verified. Admin sockets are untouched (no re-check, no close). Closing touches only the hub link, never
  // InsightSentry (the one upstream socket lives in the book-recorder's Durable Object).
  const rtIsAdmin = await isAdminToken(rtTok);
  let rtExp = 0;
  try { rtExp = JSON.parse(atob(rtTok.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).exp || 0; } catch (e) {}

  const pair = new WebSocketPair();
  const client = pair[0], server = pair[1];
  server.accept();

  const dp = 200;
  // DELIVERY DIAGNOSTICS (Owner 2026-10-14: "if we are getting tick data, why are the candles not
  // moving fast?"). The browser received ~1.1 bar updates/s on NQ 1m in a busy session with ~0.8 s
  // gaps, which matches InsightSentry's adaptive slow-consumer conflation (1/2/4 Hz). Its
  // delivery_status events are now passed on as {event:'delivery', mode, hz, dropped} so the chart
  // test (tools/tests/chart-tick-rate.js) can see which mode the feed is in, and a 'stats' event
  // every 10 s says how many upstream messages arrived. No vendor data or key in either.
  // sc=disconnect (tests only) subscribes WITHOUT adaptive delivery, for an A/B of the two modes.
  const policy = url.searchParams.get('sc') === 'disconnect' ? 'disconnect' : 'adaptive';
  let upMsgs = 0, upBars = 0;
  const statsTimer = setInterval(() => { send({ event: 'stats', up: upMsgs, bars: upBars, policy, of: ofMode ? ofSent : undefined }); upMsgs = 0; upBars = 0; ofSent = 0; }, 10000);
  // HEARTBEAT (2026-10-20, frozen candles): {event:'ping', up} every 5 s so the browser can tell a quiet
  // market from a dead socket; up = ms since the hub last heard InsightSentry. Since 2026-10-22 a quiet or slow
  // InsightSentry does NOT end this socket (that reconnect storm is what got us throttled): the hub has its own
  // backoff. Only a dead link to the hub (no hub ping for 20 s) ends it.
  let lastUpAt = Date.now();
  const hbTimer = setInterval(() => {
    send({ event: 'ping', t: Date.now(), up: hubUp >= 0 ? hubUp : Date.now() - lastUpAt });
    if (Date.now() - linkAt > 20000) close(1011, 'hub link silent');
  }, 5000);
  const rtTimer = rtIsAdmin ? null : setInterval(async () => {
    if (closed) return;
    if (!(rtExp > Date.now() / 1000 + 5)) return close(4001, 'token expired');
    try { if (!(await isRealtimeToken(rtTok))) close(4003, 'real-time access ended'); } catch (e) {}
  }, 60000);
  const dec = decOf(SYMBOLS[sym][4]);
  // TICK MODE (ticks=1): a second leg subscribes InsightSentry's per-trade feed (bar_type 'tick') and
  // folds every trade into the forming bar of the requested timeframe, so the chart's last candle,
  // price line and axis label move with the tape instead of with the ~1 Hz series updates. The
  // series leg still carries the history (dp) and closes bars. Trades are coalesced to at most one
  // 'bar' message per 100 ms (<= 10/s to the browser). Seconds/tick timeframes do not use it.
  const tickMode = url.searchParams.get('ticks') === '1' && !!(TIMEFRAMES[tf] && TIMEFRAMES[tf].step);
  const step = tickMode ? TIMEFRAMES[tf].step : 0;
  // LIVE ORDER FLOW (of=1, CoS GO 2026-10-24 "deep data speed" a1): the same tick leg's prints, WITH their
  // buy/sell tag, are passed on as {event:'trades', s, tr:[[t, price, vol, side 1/0/-1], ...]} at most every
  // OF_FLUSH_MS, so the admin chart builds the forming minute's footprint / delta / CVD / big trades itself
  // (assets/chart-live-of.js) instead of waiting 10-30 s for the recorder. No extra InsightSentry leg or
  // message: it reuses the tick leg. Admin only (this whole socket is). NQ and ES only. A burst is capped at
  // OF_MAX_ROWS per message; the rest goes in the next one.
  const OF_FLUSH_MS = 250, OF_MAX_ROWS = 2000;
  const ofMode = tickMode && url.searchParams.get('of') === '1' && (sym === 'NQ' || sym === 'ES');
  let ofBuf = [], ofTimer = null, ofSent = 0;
  const ofFlush = () => {
    ofTimer = null;
    if (!ofBuf.length) return;
    const out = ofBuf.length > OF_MAX_ROWS ? ofBuf.splice(0, OF_MAX_ROWS) : ofBuf.splice(0);
    ofSent += out.length;
    send({ event: 'trades', s: sym, tr: out });
    if (ofBuf.length) ofTimer = setTimeout(ofFlush, 20);
  };
  const ofAdd = (x) => {
    const t = Number(x.time), c = r(Number(x.close)), v = Number(x.volume);
    if (!(t > 0) || !Number.isFinite(c) || !(v > 0)) return;
    ofBuf.push([Math.round(t * 1e6) / 1e6, c, v, x.type === 'buy' ? 1 : x.type === 'sell' ? 0 : -1]);
    if (ofBuf.length > 20000) ofBuf.splice(0, ofBuf.length - 20000);   // a stalled browser socket: keep the newest
    if (!ofTimer) ofTimer = setTimeout(ofFlush, OF_FLUSH_MS);
  };
  const r = rounder(dec);
  let forming = null;      // [t, o, h, l, c, v] of the newest bar
  let lastTickAt = 0;      // ms; while trades flow, a lagging series update cannot move close back
  let flushTimer = null;
  // 1-minute rows seen on the symbol's one series leg, kept to rebuild the forming bucket of a longer timeframe
  const minRows = new Map();
  let minFirst = Infinity;
  const foldRows = (rows) => {
    for (const x of rows) { minRows.set(x[0], x); if (x[0] < minFirst) minFirst = x[0]; }
    if (minRows.size > 700) { const ks = [...minRows.keys()].sort((a, b) => a - b); for (let i = 0; i < ks.length - 600; i++) minRows.delete(ks[i]); minFirst = Math.max(minFirst, ks[ks.length - 600]); }
    const touched = [...new Set(rows.map((x) => bucketOf(x[0])))].sort((a, b) => a - b);
    const out = [];
    for (const b of touched) {
      if (minFirst > b) continue;   // the 1-minute history we hold starts inside this bucket: would be a partial bar
      const mine = [...minRows.values()].filter((x) => bucketOf(x[0]) === b).sort((a, b2) => a[0] - b2[0]);
      if (!mine.length) continue;
      let hi = -Infinity, lo = Infinity, vol = 0;
      for (const x of mine) { if (x[2] > hi) hi = x[2]; if (x[3] < lo) lo = x[3]; vol += x[5]; }
      out.push([b, mine[0][1], hi, lo, mine[mine.length - 1][4], vol]);
    }
    return out;
  };
  const bucketOf = (t) => (spec.agg && spec.agg > 1 ? aggregateHours([[t, 0, 0, 0, 0, 0]], spec.agg, 18)[0][0] : Math.floor(t / (spec.step || step)) * (spec.step || step));
  const flush = () => { flushTimer = null; if (forming) send({ event: 'bar', s: sym, tf, bar: forming.slice() }); };
  const onTick = (t, price, vol) => {
    if (!Number.isFinite(t) || !Number.isFinite(price)) return;
    const b = bucketOf(Math.floor(t));
    if (!forming || b > forming[0]) {
      if (forming && b > forming[0]) send({ event: 'bar', s: sym, tf, bar: forming.slice() }); // close out the old one
      forming = [b, price, price, price, price, 0];
    } else if (b < forming[0]) return; // late trade for a closed bar: the series leg owns those
    if (price > forming[2]) forming[2] = price;
    if (price < forming[3]) forming[3] = price;
    forming[4] = price;
    forming[5] += Math.round(vol || 0);
    lastTickAt = Date.now();
    upBars++;
    if (!flushTimer) flushTimer = setTimeout(flush, 100);
  };
  const onSeriesRow = (row) => {
    if (!tickMode) return row;
    if (!forming || row[0] > forming[0]) { forming = row.slice(); return row; }
    if (row[0] < forming[0]) return row;
    // same bar: the series has the exchange's own OHLCV; keep the widest range and, while trades
    // are flowing, the newest trade price as close
    const out = [row[0], row[1], Math.max(row[2], forming[2]), Math.min(row[3], forming[3]), Date.now() - lastTickAt < 3000 ? forming[4] : row[4], Math.max(row[5], forming[5])];
    forming = out.slice();
    return out;
  };
  let upstream = null;
  let closed = false;
  const send = (obj) => { try { if (!closed) server.send(JSON.stringify(obj)); } catch (e) {} };
  const close = (code = 1000, reason = 'closed') => {
    if (closed) return;
    closed = true;
    clearInterval(statsTimer); clearInterval(hbTimer); if (rtTimer) clearInterval(rtTimer);
    if (flushTimer) clearTimeout(flushTimer);
    if (ofTimer) clearTimeout(ofTimer);
    try { upstream && upstream.close(1000, 'bye'); } catch (e) {}
    try { server.close(code, reason); } catch (e) {}
  };

  // One handler for a parsed hub message (raw InsightSentry series messages for our legs + hub events).
  const onUp = (msg) => {
    if (!msg) return;
    if (msg.event === 'ping') { hubUp = Number(msg.up); return; }
    if (msg.event === 'hub_attached') return;
    if (msg.event === 'hub_rejected') return close(1011, 'upstream rejected');
    if (msg.event === 'hub_full' || msg.event === 'hub_paused') { send({ event: msg.event }); return; }
    if (msg.event === 'hub_down') return;
    lastUpAt = Date.now();
    upMsgs++;
    if (msg.event === 'delivery_status') { send({ event: 'delivery', mode: msg.mode, hz: msg.max_rate_hz, dropped: msg.dropped_updates }); return; }
    if (tickMode && /T$/i.test(String(msg.bar_type || ''))) {
      const rowsT = Array.isArray(msg.series) ? msg.series : [];
      for (const x of rowsT) { onTick(Number(x.time), r(Number(x.close)), Number(x.volume)); if (ofMode && x) ofAdd(x); }
      return;
    }
    let rows = barsFrom(msg, dec);
    if (spec.fold) rows = foldRows(rows);
    else if (spec.agg && spec.agg > 1 && rows.length > 1) rows = aggregateHours(rows, spec.agg, 18);
    upBars += rows.length;
    for (const row of rows) send({ event: 'bar', s: sym, tf, bar: onSeriesRow(row) });
  };
  // ONE UPSTREAM FOR THE WHOLE SITE (2026-10-22 P0, InsightSentry throttled us at 141 requests / window, limit 120):
  // this bridge NEVER opens an InsightSentry socket. It attaches to the book-recorder Worker's IS hub (a single
  // Durable Object holding the one realtime socket, workers/book-recorder/src/is-hub.js). A browser reconnect or
  // stall-watchdog reopen therefore only re-attaches to that hub; it costs InsightSentry nothing.
  let hubUp = -1, linkAt = Date.now();
  const legs = [code + '|' + spec.bar_type + '|' + spec.bar_interval];
  if (tickMode) legs.push(code + '|tick|1');
  const startHub = async () => {
    const res = await fetch(RECORDER_URL + '/is-live?legs=' + encodeURIComponent(legs.join(';')), { headers: { upgrade: 'websocket', authorization: 'Bearer ' + wsTokenOf(ctx.request) } });
    const ws = res.webSocket;
    if (!ws) { send({ event: 'hub_error', status: res.status }); return close(1011, 'hub refused ' + res.status); }
    ws.accept();
    upstream = ws;
    if (closed) { try { ws.close(1000, 'bye'); } catch (e) {} return; }
    send({ event: 'connected', s: sym, tf, hub: true });
    ws.addEventListener('message', (ev) => {
      linkAt = Date.now();
      let msg;
      try { msg = JSON.parse(typeof ev.data === 'string' ? ev.data : new TextDecoder().decode(ev.data)); } catch (e) { return; }
      onUp(msg);
    });
    ws.addEventListener('close', () => close(1011, 'hub closed'));
    ws.addEventListener('error', () => close(1011, 'hub error'));
  };

  try {
    startHub().catch(() => close(1011, 'hub failed'));
    // the admin check is made at connect; end the socket after 50 min so a revoked admin (or an
    // expired token) re-checks. The client re-opens at once with a fresh token.
    setTimeout(() => close(4000, 'reauth'), 50 * 60 * 1000);
    server.addEventListener('close', () => close());
    server.addEventListener('error', () => close());
  } catch (e) {
    close(1011, 'stream failed');
  }
  return new Response(null, { status: 101, webSocket: client, headers: { 'sec-websocket-protocol': 'tz-auth' } });
}
