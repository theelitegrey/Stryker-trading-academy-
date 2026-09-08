/**
 * Stryker Trading Academy — historical candles for the Backtest replay page
 *
 * Proxies Yahoo Finance's chart API (which has no CORS headers, so the
 * browser cannot call it directly) for futures, indices, FX and metals.
 * Crypto never touches this function — the page reads Binance directly.
 *
 * GET /replayBars?symbol=NQ%3DF&interval=1m&period1=<unix s>&period2=<unix s>
 *   interval: 1m | 5m | 15m | 30m | 1h | 1d
 *   → { symbol, interval, bars: [[openTimeMs, o, h, l, c, v], …], chunks }
 *
 * Yahoo limits: 1m data exists only for the last 30 days and at most 7 days
 * per request; 5m/15m/30m for 60 days; 1h for 730 days; 1d unlimited. The
 * function chunks 1m requests into 7-day windows and merges them.
 *
 * Responses are cached in memory per instance (6h for fully-historical
 * ranges, 5 min when the range reaches "now") and marked cacheable for the
 * CDN, so a class replaying the same week does not hammer Yahoo.
 *
 * DEPLOY (name every function or the others get deleted):
 *   firebase deploy --only functions:replayBars
 */

const functions = require('firebase-functions');

const UA = { 'User-Agent': 'Mozilla/5.0 (StrykerTradingAcademy replay; +https://strykertrading.com)' };
const INTERVALS = { '1m': 60, '5m': 300, '15m': 900, '30m': 1800, '1h': 3600, '1d': 86400 };
const CHUNK_DAYS = { '1m': 7, '5m': 59, '15m': 59, '30m': 59, '1h': 729, '1d': 36500 };
const MAX_DAYS = { '1m': 31, '5m': 61, '15m': 61, '30m': 61, '1h': 731, '1d': 36500 };
const cache = new Map();

function bad(res, msg, code) { res.status(code || 400).json({ error: msg }); }

async function fetchChunk(symbol, interval, p1, p2) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&period1=${p1}&period2=${p2}&includePrePost=true&events=`;
  const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(20000) });
  if (!r.ok) {
    if (r.status === 404) throw new Error('Yahoo does not know the symbol ' + symbol);
    throw new Error('Yahoo returned ' + r.status);
  }
  const json = await r.json();
  const res = json && json.chart && json.chart.result && json.chart.result[0];
  if (!res) {
    const err = json && json.chart && json.chart.error;
    throw new Error(err && err.description ? err.description : 'Yahoo returned no data');
  }
  const ts = res.timestamp || [];
  const q = (res.indicators && res.indicators.quote && res.indicators.quote[0]) || {};
  const out = [];
  for (let i = 0; i < ts.length; i++) {
    const o = q.open && q.open[i], h = q.high && q.high[i], l = q.low && q.low[i], c = q.close && q.close[i];
    if (o == null || h == null || l == null || c == null) continue;
    out.push([ts[i] * 1000, +o.toFixed(6), +h.toFixed(6), +l.toFixed(6), +c.toFixed(6), Math.round((q.volume && q.volume[i]) || 0)]);
  }
  return out;
}

exports.replayBars = functions
  .runWith({ timeoutSeconds: 60, memory: '256MB' })
  .https.onRequest(async (req, res) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
    if (req.method === 'OPTIONS') { res.status(204).send(''); return; }

    const symbol = String(req.query.symbol || '').toUpperCase();
    const interval = String(req.query.interval || '1h');
    let p1 = Math.floor(Number(req.query.period1)), p2 = Math.floor(Number(req.query.period2));
    if (!/^[A-Z0-9^=.\-]{1,14}$/.test(symbol)) return bad(res, 'Invalid symbol');
    if (!INTERVALS[interval]) return bad(res, 'interval must be one of ' + Object.keys(INTERVALS).join(', '));
    const now = Math.floor(Date.now() / 1000);
    if (!isFinite(p1) || !isFinite(p2) || p2 <= p1) return bad(res, 'period1/period2 must be unix seconds with period2 > period1');
    p2 = Math.min(p2, now);
    if (p1 < now - MAX_DAYS[interval] * 86400) p1 = now - MAX_DAYS[interval] * 86400;
    if (p2 - p1 > 400 * 86400 && interval !== '1d') return bad(res, 'Range too large for ' + interval);

    const key = `${symbol}|${interval}|${p1}|${p2}`;
    const hit = cache.get(key);
    const reachesNow = p2 > now - 3600;
    if (hit && Date.now() - hit.at < (reachesNow ? 5 : 360) * 60000) { res.set('Cache-Control', 'public, max-age=300'); res.json(hit.body); return; }

    try {
      const chunk = CHUNK_DAYS[interval] * 86400;
      const rows = []; let chunks = 0;
      for (let a = p1; a < p2 && chunks < 12; a += chunk) {
        const part = await fetchChunk(symbol, interval, a, Math.min(p2, a + chunk));
        rows.push(...part); chunks++;
      }
      rows.sort((x, y) => x[0] - y[0]);
      const bars = []; for (const r of rows) if (!bars.length || bars[bars.length - 1][0] !== r[0]) bars.push(r);
      const body = { symbol, interval, period1: p1, period2: p2, bars, chunks };
      cache.set(key, { at: Date.now(), body });
      if (cache.size > 60) cache.delete(cache.keys().next().value);
      res.set('Cache-Control', 'public, max-age=300');
      res.json(body);
    } catch (err) {
      console.error('replayBars', symbol, interval, err);
      res.status(502).json({ error: 'Could not load candles: ' + (err.message || err) });
    }
  });
