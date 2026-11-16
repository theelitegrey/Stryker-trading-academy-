import { ledgerCryptoIconUrl, baseOf } from '../chunk-W4EJWLEO.js';

// TradeZoro addition (not in Vela): Kraken provider, SPOT ("XBTUSD", "ETHEUR"), public REST + WebSocket v2, no key.
// Kraken's REST OHLC returns only the newest 720 candles per interval (no way to page back), so history is capped
// at 720 bars of the chosen interval. Kraken perpetuals (futures.kraken.com) send no CORS headers for REST, so they
// are not offered as chart symbols; their order book and trades are in the Book panel (WebSocket has no CORS rule).
var REST = "https://api.kraken.com/0/public";
var WS_URL = "wss://ws.kraken.com/v2";
var STREAM_STALL_MS = 15e3;
var STREAM_RECONNECT_MS = 2e3;
var NATIVE_MINUTES = [1, 5, 15, 30, 60, 240, 1440, 10080];
var TF_NORMALIZE = {
  "1m": "1", "3m": "3", "5m": "5", "15m": "15", "30m": "30", "45m": "45", "1h": "60", "2h": "120", "3h": "180",
  "4h": "240", "6h": "360", "8h": "480", "12h": "720", "1d": "D", "1w": "W", "1mo": "M", "1D": "D", "1W": "W", "4H": "240",
  D: "D", W: "W", M: "M"
};
var SUPPORTED_TIMEFRAMES = ["1", "3", "5", "15", "30", "45", "60", "120", "180", "240", "360", "480", "720", "D", "W", "M"];
function normalizeTf(tf) {
  return TF_NORMALIZE[tf] ?? TF_NORMALIZE[String(tf).toLowerCase()] ?? tf;
}
// Chart timeframe -> minutes of the REST/WS interval, or null for the calendar month (built from days)
function minutesOf(tf) {
  if (tf === "D") return 1440;
  if (tf === "W") return 10080;
  if (tf === "M") return null;
  return /^\d+$/.test(tf) ? parseInt(tf, 10) : NaN;
}
function selectSubTf(targetMin) {
  return NATIVE_MINUTES.filter((m) => m < targetMin && targetMin % m === 0).sort((a, b) => b - a)[0] ?? null;
}
function dedupeSorted(bars) {
  var by = /* @__PURE__ */ new Map();
  for (var b of bars) by.set(b.time, b);
  return [...by.values()].sort((a, b) => a.time - b.time);
}
function aggregate(sub, keyOf) {
  var buckets = /* @__PURE__ */ new Map();
  for (var b of sub) {
    var key = keyOf(b.time);
    var cur = buckets.get(key);
    if (!cur) buckets.set(key, { time: key, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume ?? 0 });
    else {
      cur.high = Math.max(cur.high, b.high);
      cur.low = Math.min(cur.low, b.low);
      cur.close = b.close;
      cur.volume = (cur.volume ?? 0) + (b.volume ?? 0);
    }
  }
  return [...buckets.values()].sort((a, b) => a.time - b.time);
}
var monthKey = (t) => { var d = new Date(t); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1); };
// REST OHLC result -> bars. rows: [time(s), o, h, l, c, vwap, volume, count]; result also has "last".
function restToBars(j) {
  if (!j || (j.error && j.error.length) || !j.result) return [];
  var key = Object.keys(j.result).find((k) => k !== "last");
  var rows = key ? j.result[key] : [];
  return rows.map((k) => ({ time: Number(k[0]) * 1e3, open: Number(k[1]), high: Number(k[2]), low: Number(k[3]), close: Number(k[4]), volume: Number(k[6]) }));
}
// WebSocket v2 ohlc message -> bars (a snapshot is forwarded as its newest two bars only)
function wsToBars(msg) {
  if (!msg || msg.channel !== "ohlc" || !Array.isArray(msg.data)) return [];
  var rows = msg.type === "snapshot" ? msg.data.slice(-2) : msg.data;
  return rows.map((k) => ({ time: Date.parse(k.interval_begin), open: k.open, high: k.high, low: k.low, close: k.close, volume: k.volume })).filter((b) => Number.isFinite(b.time));
}
// AssetPairs result -> symbols; ticker = altname ("XBTUSD", like TradingView's KRAKEN:XBTUSD), ws = "BTC/USD"
function parsePairs(j) {
  var r = j && j.result || {};
  var out = [];
  for (var k of Object.keys(r)) {
    var p = r[k];
    if (!p || !p.wsname || k.endsWith(".d") || (p.status && p.status !== "online")) continue;
    var [b, q] = p.wsname.replace(/^XBT\//, "BTC/").split("/");  // REST says XBT, WebSocket v2 says BTC
    out.push({ ticker: p.altname, ws: b + "/" + q, description: b + " / " + q, type: "crypto", base: b, quote: q, tick: Number(p.tick_size) || Math.pow(10, -(p.pair_decimals ?? 2)) });
  }
  return out;
}

var hub = {
  ws: null, subs: /* @__PURE__ */ new Map(), timer: null, retry: 0, ping: null,
  key: (a) => a.channel + "|" + a.symbol + "|" + (a.interval || ""),
  add(arg, cb) {
    var k = hub.key(arg);
    var e = hub.subs.get(k);
    if (!e) {
      e = { arg, cbs: /* @__PURE__ */ new Set() };
      hub.subs.set(k, e);
      hub.send({ method: "subscribe", params: { channel: arg.channel, symbol: [arg.symbol], ...arg.interval ? { interval: arg.interval } : {} } });
    }
    e.cbs.add(cb);
    hub.open();
    return () => {
      e.cbs.delete(cb);
      if (!e.cbs.size && hub.subs.get(k) === e) {
        hub.subs.delete(k);
        hub.send({ method: "unsubscribe", params: { channel: arg.channel, symbol: [arg.symbol], ...arg.interval ? { interval: arg.interval } : {} } });
      }
      if (!hub.subs.size) hub.close();
    };
  },
  send(o) { try { if (hub.ws && hub.ws.readyState === 1) hub.ws.send(JSON.stringify(o)); } catch {} },
  open() {
    if (hub.ws || typeof WebSocket === "undefined") return;
    var ws = new WebSocket(WS_URL);
    hub.ws = ws;
    ws.onopen = () => {
      hub.retry = 0;
      for (var e of hub.subs.values()) hub.send({ method: "subscribe", params: { channel: e.arg.channel, symbol: [e.arg.symbol], ...e.arg.interval ? { interval: e.arg.interval } : {} } });
      hub.ping = setInterval(() => hub.send({ method: "ping" }), 3e4);
    };
    ws.onmessage = (ev) => {
      var msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (!msg || !msg.channel || !Array.isArray(msg.data)) return;
      var first = msg.data[0] || {};
      var k = hub.key({ channel: msg.channel, symbol: first.symbol, interval: msg.channel === "ohlc" ? first.interval : "" });
      var e = hub.subs.get(k);
      if (e) e.cbs.forEach((cb) => { try { cb(msg); } catch {} });
    };
    ws.onclose = () => {
      clearInterval(hub.ping);
      if (hub.ws === ws) hub.ws = null;
      if (hub.subs.size) {
        clearTimeout(hub.timer);
        hub.timer = setTimeout(hub.open, Math.min(3e4, STREAM_RECONNECT_MS * Math.pow(2, hub.retry++)));
      }
    };
    ws.onerror = () => { try { ws.close(); } catch {} };
  },
  close() {
    clearTimeout(hub.timer);
    clearInterval(hub.ping);
    var ws = hub.ws;
    hub.ws = null;
    try { ws && ws.close(); } catch {}
  }
};

var KrakenProvider = class {
  constructor() {
    this.pairsPromise = null;
  }
  info() {
    return {
      name: "kraken",
      displayName: "Kraken",
      requiresApiKey: false,
      supportedTimeframes: SUPPORTED_TIMEFRAMES,
      capabilities: { enumerate: true, stream: true, symbolInfo: true }
    };
  }
  async getBars(ticker, timeframe, range) {
    try {
      var t = ticker.trim().toUpperCase();
      var tf = normalizeTf(timeframe);
      var min = minutesOf(tf);
      var limit = range.limit;
      var keep = (bars) => {
        if (range.from != null) bars = bars.filter((b) => b.time >= range.from);
        if (range.to != null) bars = bars.filter((b) => b.time <= range.to);
        return limit != null && bars.length > limit ? bars.slice(-limit) : bars;
      };
      if (min != null && NATIVE_MINUTES.includes(min)) return keep(dedupeSorted(await this.ohlc(t, min, range.from)));
      if (min == null) return keep(aggregate(dedupeSorted(await this.ohlc(t, 1440, range.from)), monthKey));
      var sub = Number.isFinite(min) ? selectSubTf(min) : null;
      if (!sub) {
        console.warn('[vela] Kraken: timeframe "' + timeframe + '" is not supported and cannot be aggregated.');
        return [];
      }
      return keep(aggregate(dedupeSorted(await this.ohlc(t, sub, range.from)), (x) => Math.floor(x / (min * 6e4)) * min * 6e4));
    } catch (e) {
      console.warn("[vela] Kraken: failed to fetch " + ticker + " " + timeframe + " \u2014 " + (e instanceof Error ? e.message : String(e)));
      return [];
    }
  }
  async ohlc(pair, minutes, from) {
    var u = REST + "/OHLC?pair=" + encodeURIComponent(pair) + "&interval=" + minutes + (from != null ? "&since=" + (Math.floor(from / 1e3) - 1) : "");
    var j = await this.json(u);
    if (j.error && j.error.length) throw new Error("Kraken " + j.error.join(","));
    return restToBars(j);
  }
  pairs() {
    return this.pairsPromise ?? (this.pairsPromise = this.json(REST + "/AssetPairs").then(parsePairs).catch((e) => { this.pairsPromise = null; throw e; }));
  }
  async getSymbolInfo(ticker) {
    var t = ticker.trim().toUpperCase();
    var s = (await this.pairs().catch(() => [])).find((x) => x.ticker === t);
    if (!s) return void 0;
    return {
      ticker, tickerid: "KRAKEN:" + ticker, prefix: "KRAKEN", description: s.description, type: "crypto",
      basecurrency: s.base, currency: s.quote, mintick: s.tick, pricescale: Math.round(1 / s.tick), timezone: "Etc/UTC", session: "24x7"
    };
  }
  async listSymbols() {
    return (await this.pairs()).map((s) => ({ ticker: s.ticker, description: s.description, type: "crypto" }));
  }
  resolveSymbolIcon(symbol) {
    return ledgerCryptoIconUrl(baseOf(symbol));
  }
  subscribe(ticker, timeframe, onBar) {
    var min = minutesOf(normalizeTf(timeframe));
    if (min != null && [1, 5, 15, 30, 60, 240, 1440, 10080].includes(min) && typeof WebSocket !== "undefined") return this.stream(ticker, timeframe, min, onBar);
    return this.pollBars(ticker, timeframe, onBar);
  }
  stream(ticker, timeframe, min, onBar) {
    var closed = false, polling = null, off = null, stall = null;
    var fall = () => {
      if (closed || polling) return;
      if (off) off();
      off = null;
      console.warn("[vela] Kraken: " + ticker + " " + timeframe + " stream delivered no data; falling back to polling.");
      polling = this.pollBars(ticker, timeframe, onBar);
    };
    stall = setTimeout(fall, STREAM_STALL_MS);
    this.pairs().then((list) => {
      if (closed) return;
      var p = list.find((x) => x.ticker === ticker.trim().toUpperCase());
      if (!p) return fall();
      off = hub.add({ channel: "ohlc", symbol: p.ws, interval: min }, (msg) => {
        if (closed || polling) return;
        var bars = wsToBars(msg);
        if (bars.length) clearTimeout(stall);
        bars.forEach(onBar);
      });
    }).catch(fall);
    return () => { closed = true; clearTimeout(stall); if (off) off(); polling?.(); };
  }
  pollBars(ticker, timeframe, onBar) {
    var stopped = false, timer = null;
    var poll = async () => {
      if (stopped) return;
      try { (await this.getBars(ticker, timeframe, { limit: 2 })).forEach((b) => onBar(b)); } catch {}
      if (!stopped) timer = setTimeout(() => void poll(), 5e3);
    };
    timer = setTimeout(() => void poll(), 5e3);
    return () => { stopped = true; if (timer) clearTimeout(timer); };
  }
  async json(url) {
    var res = await fetch(url);
    if (!res.ok) throw new Error("Kraken HTTP " + res.status);
    return res.json();
  }
};

export { KrakenProvider, restToBars, wsToBars, parsePairs };
