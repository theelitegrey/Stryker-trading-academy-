// GET /api/chart/stream/:sym?tf=1 — server-side InsightSentry WebSocket bridge.
// The browser never sees INSIGHTSENTRY_WEBSOCKET_API_KEY. Only allow-listed futures roots stream.
import { INSIGHTSENTRY_WS, INSIGHTSENTRY_CODES, TIMEFRAMES, SYMBOLS, normSym, normTf, aggregateHours } from '../_bars.js';

const ALLOWED_ORIGINS = new Set(['https://strykertrading.com', 'https://www.strykertrading.com', 'http://localhost:8000']);
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
  const o = Number(x?.open ?? x?.o), h = Number(x?.high ?? x?.h), l = Number(x?.low ?? x?.l), c = Number(x?.close ?? x?.c);
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

  const pair = new WebSocketPair();
  const client = pair[0], server = pair[1];
  server.accept();

  const dp = 200;
  const dec = decOf(SYMBOLS[sym][4]);
  let upstream = null;
  let closed = false;
  const send = (obj) => { try { if (!closed) server.send(JSON.stringify(obj)); } catch (e) {} };
  const close = (code = 1000, reason = 'closed') => {
    if (closed) return;
    closed = true;
    try { upstream && upstream.close(); } catch (e) {}
    try { server.close(code, reason); } catch (e) {}
  };

  try {
    upstream = new WebSocket(INSIGHTSENTRY_WS);
    upstream.onopen = () => {
      upstream.send(JSON.stringify({ api_key: key, slow_consumer_policy: 'adaptive', subscriptions: [{ code, type: 'series', bar_type: spec.bar_type, bar_interval: spec.bar_interval, dp, '24h': true }] }));
      send({ event: 'connected', s: sym, tf });
    };
    upstream.onerror = () => close(1011, 'upstream error');
    upstream.onclose = () => close(1000, 'upstream closed');
    upstream.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch (e) { return; }
      const text = JSON.stringify(msg).toLowerCase();
      if (/invalid|unauthori[sz]ed|expired|subscription_expired|websocket_access_required/.test(text)) return close(1011, 'upstream rejected');
      let rows = barsFrom(msg, dec);
      if (spec.agg && spec.agg > 1 && rows.length > 1) rows = aggregateHours(rows, spec.agg, 18);
      for (const row of rows) send({ event: 'bar', s: sym, tf, bar: row });
    };
    server.addEventListener('close', () => close());
    server.addEventListener('error', () => close());
  } catch (e) {
    close(1011, 'stream failed');
  }
  return new Response(null, { status: 101, webSocket: client });
}
