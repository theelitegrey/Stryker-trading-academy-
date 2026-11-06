// TradeZoro — Charts: tick-speed candles for Binance spot (ES module)
// Depends on: Vela's BinanceProvider (assets/vendor/vela-0.6.17-s3/providers/binance.js, unmodified).
// Imported by assets/vela-chart.js, which registers boostBinance(BinanceProvider) as the "binance" provider.
//
// Owner 2026-10-14: "if we are getting tick data, why are the candles not moving fast?". Binance's
// kline stream (what Vela subscribes) pushes the forming candle about once a second. This adds the
// same symbol's public aggTrade stream (every trade, no key) and folds each trade into the forming
// candle: close, high, low and volume move with the tape. Updates are coalesced to ONE onBar per
// animation frame (<= 60/s, never a backlog), and while the tab is hidden nothing is sent. The kline
// stream stays the source of truth: every kline update replaces the forming candle, and a new
// candle only starts from a kline (or a trade whose time is past the current candle's end).
// Spot USDT-style tickers only; perpetuals/US venue fall back to Vela's own behaviour.
// boostVenue does the same for other venues through their order-flow adapter (assets/orderflow-venues.js).

import { getVenue } from './orderflow-venues.js?v=895';
import './orderflow-venue-hyperliquid.js?v=895';
import './orderflow-venue-bybit.js?v=895';
import './orderflow-venue-okx.js?v=895';
import './orderflow-venue-bitget.js?v=895';
import './orderflow-venue-kraken.js?v=895';

const WS = 'wss://stream.binance.com:9443/ws/';
const STEP = { '1': 60e3, '3': 180e3, '5': 300e3, '15': 900e3, '30': 1800e3, '60': 3600e3, '120': 7200e3, '240': 14400e3,
  '1m': 60e3, '3m': 180e3, '5m': 300e3, '15m': 900e3, '30m': 1800e3, '1h': 3600e3, '2h': 7200e3, '4h': 14400e3 };

export function boostBinance(BinanceProvider) {
  return boost(BinanceProvider, (t) => /^[A-Z0-9]{5,20}$/.test(t), binanceTrades);
}
// Another crypto venue (assets/orderflow-venues.js adapter, e.g. 'hyperliquid'): the same fold, fed by its trade stream.
export function boostVenue(Provider, id) {
  return boost(Provider, (t) => !!getVenue(id) && /^[A-Z0-9/@.-]{1,30}$/i.test(t), (t, onTrade) => {
    let first = true;   // the first batch is the venue's recent trades: older ones fall before the forming candle and are dropped below
    return getVenue(id).tradeStream(t, { trade: (x) => onTrade(x.p, x.s, x.t, first), status: (st) => { if (st === 'live') first = false; } });
  });
}
// Binance spot aggTrade socket (own retries; klines keep the chart live regardless).
function binanceTrades(t, onTrade) {
  let stopped = false, ws = null, retry = null, tries = 0;
  const open = () => {
    if (stopped) return;
    let sock;
    try { sock = new WebSocket(WS + t.toLowerCase() + '@aggTrade'); } catch (e) { return; }
    ws = sock;
    sock.onmessage = (ev) => {
      if (stopped) return;
      let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
      const p = Number(m.p), q = Number(m.q), tt = Number(m.T);
      if (!Number.isFinite(p) || !Number.isFinite(tt)) return;
      tries = 0;
      onTrade(p, q, tt);
    };
    sock.onclose = () => {
      if (ws !== sock) return; ws = null;
      if (stopped || tries >= 6) return;                 // klines keep the chart live regardless
      retry = setTimeout(open, Math.min(30000, 1000 * Math.pow(2, tries++)));
    };
    sock.onerror = () => { try { sock.close(); } catch (e) {} };
  };
  open();
  return () => { stopped = true; if (retry) clearTimeout(retry); const s = ws; ws = null; try { if (s) s.close(); } catch (e) {} };
}

function boost(Base, okTicker, openTrades) {
  return class TickBoostProvider extends Base {
    subscribe(ticker, timeframe, onBar, ...rest) {
      const raw = String(ticker || '').replace(/^[a-z_]+:/i, '');
      const t = openTrades === binanceTrades ? raw.toUpperCase() : raw.trim();
      const step = STEP[String(timeframe)];
      if (!step || !okTicker(t) || typeof WebSocket !== 'function' || typeof requestAnimationFrame !== 'function') {
        return super.subscribe(ticker, timeframe, onBar, ...rest);
      }
      let stopped = false;
      let forming = null;   // the chart's forming candle as we know it
      let pending = false;
      const emit = () => {
        pending = false;
        if (stopped || !forming || (typeof document !== 'undefined' && document.hidden)) return;
        onBar(Object.assign({}, forming));
      };
      const schedule = () => { if (!pending) { pending = true; requestAnimationFrame(emit); } };
      const unsubKline = super.subscribe(ticker, timeframe, (bar) => {
        if (stopped) return;
        if (!forming || bar.time >= forming.time) forming = Object.assign({}, bar);
        onBar(bar);
      }, ...rest);
      const stopTrades = openTrades(t, (p, q, tt, old) => {
        if (stopped || !forming) return;
        if (tt < forming.time) return;                    // belongs to a closed candle
        if (old) return;                                  // backfill batch: the kline already holds it
        if (tt >= forming.time + step) {                  // the kline for the new candle has not arrived yet
          forming = { time: Math.floor(tt / step) * step, open: p, high: p, low: p, close: p, volume: 0 };
        }
        if (p > forming.high) forming.high = p;
        if (p < forming.low) forming.low = p;
        forming.close = p;
        if (Number.isFinite(q)) forming.volume = (forming.volume || 0) + q;
        schedule();
      });
      return () => {
        stopped = true;
        try { if (stopTrades) stopTrades(); } catch (e) {}
        try { if (typeof unsubKline === 'function') unsubKline(); } catch (e) {}
      };
    }
  };
}
