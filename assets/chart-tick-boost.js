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

const WS = 'wss://stream.binance.com:9443/ws/';
const STEP = { '1': 60e3, '3': 180e3, '5': 300e3, '15': 900e3, '30': 1800e3, '60': 3600e3, '120': 7200e3, '240': 14400e3,
  '1m': 60e3, '3m': 180e3, '5m': 300e3, '15m': 900e3, '30m': 1800e3, '1h': 3600e3, '2h': 7200e3, '4h': 14400e3 };

export function boostBinance(BinanceProvider) {
  return class TickBinanceProvider extends BinanceProvider {
    subscribe(ticker, timeframe, onBar, ...rest) {
      const t = String(ticker || '').replace(/^[a-z_]+:/i, '').toUpperCase();
      const step = STEP[String(timeframe)];
      if (!step || !/^[A-Z0-9]{5,20}$/.test(t) || typeof WebSocket !== 'function' || typeof requestAnimationFrame !== 'function') {
        return super.subscribe(ticker, timeframe, onBar, ...rest);
      }
      let stopped = false;
      let forming = null;   // the chart's forming candle as we know it
      let pending = false;
      let ws = null, retry = null, tries = 0;
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
      const open = () => {
        if (stopped) return;
        let sock;
        try { sock = new WebSocket(WS + t.toLowerCase() + '@aggTrade'); } catch (e) { return; }
        ws = sock;
        sock.onmessage = (ev) => {
          if (stopped || !forming) return;
          let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
          const p = Number(m.p), q = Number(m.q), tt = Number(m.T);
          if (!Number.isFinite(p) || !Number.isFinite(tt)) return;
          tries = 0;
          if (tt < forming.time) return;                    // belongs to a closed candle
          if (tt >= forming.time + step) {                  // the kline for the new candle has not arrived yet
            forming = { time: Math.floor(tt / step) * step, open: p, high: p, low: p, close: p, volume: 0 };
          }
          if (p > forming.high) forming.high = p;
          if (p < forming.low) forming.low = p;
          forming.close = p;
          if (Number.isFinite(q)) forming.volume = (forming.volume || 0) + q;
          schedule();
        };
        sock.onclose = () => {
          if (ws !== sock) return; ws = null;
          if (stopped || tries >= 6) return;                 // klines keep the chart live regardless
          retry = setTimeout(open, Math.min(30000, 1000 * Math.pow(2, tries++)));
        };
        sock.onerror = () => { try { sock.close(); } catch (e) {} };
      };
      open();
      return () => {
        stopped = true;
        if (retry) clearTimeout(retry);
        const s = ws; ws = null; try { if (s) s.close(); } catch (e) {}
        try { if (typeof unsubKline === 'function') unsubKline(); } catch (e) {}
      };
    }
  };
}
