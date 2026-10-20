// GET /api/chart/stream/:sym?tf=1 — server-side InsightSentry WebSocket bridge.
// The browser never sees INSIGHTSENTRY_WEBSOCKET_API_KEY. Only allow-listed futures roots stream.
import { isRealtimeToken, wsTokenOf } from '../_rt.js';
import { INSIGHTSENTRY_WS, INSIGHTSENTRY_CODES, TIMEFRAMES, SYMBOLS, normSym, normTf, aggregateHours } from '../_bars.js';

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
  if (!cfg || !cfg.step || cfg.step < 60 || cfg.step > 3600) return null;
  if (cfg.agg) return { bar_type: 'hour', bar_interval: 1, agg: cfg.agg };
  if (cfg.step < 3600) return { bar_type: 'minute', bar_interval: Math.max(1, cfg.step / 60), agg: 1 };
  return { bar_type: 'hour', bar_interval: 1, agg: 1 };
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
  if (!(await isRealtimeToken(wsTokenOf(ctx.request)))) return err(403, 'real-time futures data is admin only; delayed data is served by /api/chart/bars');

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
  const statsTimer = setInterval(() => { send({ event: 'stats', up: upMsgs, bars: upBars, policy }); upMsgs = 0; upBars = 0; }, 10000);
  // HEARTBEAT (2026-10-20, frozen candles): {event:'ping', up} every 5 s so the browser can tell a quiet
  // market from a dead socket; up = ms since the last upstream message. If the upstream says nothing
  // for 30 s while the CME session is open it has gone silent without closing: end the socket so the
  // browser re-opens (and re-reads the tail) instead of sitting on a dead feed.
  let lastUpAt = Date.now();
  const hbTimer = setInterval(() => {
    const up = Date.now() - lastUpAt;
    send({ event: 'ping', t: Date.now(), up });
    if (up > 30000 && cmeOpenNow()) close(1011, 'upstream silent');
  }, 5000);
  const dec = decOf(SYMBOLS[sym][4]);
  // TICK MODE (ticks=1): a second leg subscribes InsightSentry's per-trade feed (bar_type 'tick') and
  // folds every trade into the forming bar of the requested timeframe, so the chart's last candle,
  // price line and axis label move with the tape instead of with the ~1 Hz series updates. The
  // series leg still carries the history (dp) and closes bars. Trades are coalesced to at most one
  // 'bar' message per 100 ms (<= 10/s to the browser). Seconds/tick timeframes do not use it.
  const tickMode = url.searchParams.get('ticks') === '1' && !!(TIMEFRAMES[tf] && TIMEFRAMES[tf].step);
  const step = tickMode ? TIMEFRAMES[tf].step : 0;
  const r = rounder(dec);
  let forming = null;      // [t, o, h, l, c, v] of the newest bar
  let lastTickAt = 0;      // ms; while trades flow, a lagging series update cannot move close back
  let flushTimer = null;
  const bucketOf = (t) => (spec.agg && spec.agg > 1 ? aggregateHours([[t, 0, 0, 0, 0, 0]], spec.agg, 18)[0][0] : Math.floor(t / step) * step);
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
    clearInterval(statsTimer); clearInterval(hbTimer);
    if (flushTimer) clearTimeout(flushTimer);
    try { upstream && upstream.close(); } catch (e) {}
    try { server.close(code, reason); } catch (e) {}
  };

  try {
    upstream = new WebSocket(INSIGHTSENTRY_WS);
    upstream.onopen = () => {
      const subs = [{ code, type: 'series', bar_type: spec.bar_type, bar_interval: spec.bar_interval, dp, '24h': true }];
      if (tickMode) subs.push({ code, type: 'series', bar_type: 'tick', bar_interval: 1, dp: 1, '24h': true });
      upstream.send(JSON.stringify({ api_key: key, slow_consumer_policy: policy, subscriptions: subs }));
      send({ event: 'connected', s: sym, tf });
    };
    upstream.onerror = () => close(1011, 'upstream error');
    upstream.onclose = () => close(1000, 'upstream closed');
    upstream.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch (e) { return; }
      const text = JSON.stringify(msg).toLowerCase();
      if (/invalid|unauthori[sz]ed|expired|subscription_expired|websocket_access_required/.test(text)) return close(1011, 'upstream rejected');
      upMsgs++; lastUpAt = Date.now();
      if (msg && msg.event === 'delivery_status') { send({ event: 'delivery', mode: msg.mode, hz: msg.max_rate_hz, dropped: msg.dropped_updates }); return; }
      if (tickMode && /T$/i.test(String(msg && msg.bar_type || ''))) {
        const rowsT = Array.isArray(msg.series) ? msg.series : [];
        for (const x of rowsT) onTick(Number(x.time), r(Number(x.close)), Number(x.volume));
        return;
      }
      let rows = barsFrom(msg, dec);
      if (spec.agg && spec.agg > 1 && rows.length > 1) rows = aggregateHours(rows, spec.agg, 18);
      upBars += rows.length;
      for (const row of rows) send({ event: 'bar', s: sym, tf, bar: onSeriesRow(row) });
    };
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
