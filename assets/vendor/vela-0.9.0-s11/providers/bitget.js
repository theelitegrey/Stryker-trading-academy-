import { ledgerCryptoIconUrl, baseOf } from '../chunk-W4EJWLEO.js';

// TradeZoro addition (not in Vela): Bitget provider, spot + USDT perpetuals ("BTCUSDT", "BTCUSDT.P").
// Public v2 REST + one public WebSocket per page, no key. Same shape as providers/binance.js.
var REST = "https://api.bitget.com/api/v2";
var WS_URL = "wss://ws.bitget.com/v2/ws/public";
var STREAM_STALL_MS = 15e3;
var STREAM_RECONNECT_MS = 2e3;
var PROD = "USDT-FUTURES";
// minutes -> [REST granularity spot, REST granularity futures, WebSocket channel]
var NATIVE = {
  1: ["1min", "1m", "candle1m"],
  3: ["3min", "3m", null],
  5: ["5min", "5m", "candle5m"],
  15: ["15min", "15m", "candle15m"],
  30: ["30min", "30m", "candle30m"],
  60: ["1h", "1H", "candle1H"],
  240: ["4h", "4H", "candle4H"],
  360: ["6h", "6H", "candle6H"],
  720: ["12h", "12H", "candle12H"]
};
var NATIVE_MINUTES = Object.keys(NATIVE).map(Number);
var BIG = { D: ["1Dutc", "1Dutc", "candle1Dutc"], W: ["1Wutc", "1Wutc", "candle1Wutc"], M: ["1Mutc", "1Mutc", "candle1Mutc"] };
var TF_NORMALIZE = {
  "1m": "1", "3m": "3", "5m": "5", "15m": "15", "30m": "30", "45m": "45", "1h": "60", "2h": "120", "3h": "180",
  "4h": "240", "6h": "360", "8h": "480", "12h": "720", "1d": "D", "1w": "W", "1mo": "M", "1D": "D", "1W": "W", "4H": "240",
  D: "D", W: "W", M: "M"
};
var SUPPORTED_TIMEFRAMES = ["1", "3", "5", "15", "30", "45", "60", "120", "180", "240", "360", "480", "720", "D", "W", "M"];
var TF_MS = { D: 864e5, W: 6048e5, M: 2592e6 };
function tfMs(tf) {
  if (TF_MS[tf]) return TF_MS[tf];
  var m = parseInt(tf, 10);
  return Number.isFinite(m) && m > 0 ? m * 6e4 : 36e5;
}
function normalizeTf(tf) {
  return TF_NORMALIZE[tf] ?? TF_NORMALIZE[String(tf).toLowerCase()] ?? tf;
}
function nativeOf(tf) {
  if (BIG[tf]) return BIG[tf];
  return /^\d+$/.test(tf) ? NATIVE[parseInt(tf, 10)] || null : null;
}
function parseTicker(ticker) {
  var t = ticker.trim().toUpperCase();
  if (t.endsWith(".P")) return { sym: t.slice(0, -2), perp: true };
  return { sym: t, perp: false };
}
// [ts, o, h, l, c, baseVol, quoteVol...] (strings) -> OHLCV
function rowToOHLCV(k) {
  return { time: Number(k[0]), open: Number(k[1]), high: Number(k[2]), low: Number(k[3]), close: Number(k[4]), volume: Number(k[5]) };
}
function dedupeSorted(bars) {
  var by = /* @__PURE__ */ new Map();
  for (var b of bars) by.set(b.time, b);
  return [...by.values()].sort((a, b) => a.time - b.time);
}
function aggregate(sub, bucketMs) {
  var buckets = /* @__PURE__ */ new Map();
  for (var b of sub) {
    var key = Math.floor(b.time / bucketMs) * bucketMs;
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
function selectSubTf(targetMin) {
  return NATIVE_MINUTES.filter((m) => m < targetMin && targetMin % m === 0).sort((a, b) => b - a)[0] ?? null;
}
// one candle channel message -> bars (a snapshot carries the last ~hundred bars: only the newest two are forwarded)
function wsCandles(msg) {
  if (!msg || !msg.arg || !String(msg.arg.channel).startsWith("candle") || !Array.isArray(msg.data)) return [];
  var rows = msg.action === "snapshot" ? msg.data.slice(-2) : msg.data;
  return rows.map(rowToOHLCV);
}
// instrument lists -> Vela symbols (+ tick sizes)
function parseSpotSymbols(j) {
  return (j && j.data || []).filter((s) => s.status === "online").map((s) => ({ ticker: s.symbol, description: s.baseCoin + " / " + s.quoteCoin, type: "crypto", base: s.baseCoin, quote: s.quoteCoin, tick: Math.pow(10, -Number(s.pricePrecision || 2)) }));
}
function parsePerpSymbols(j) {
  return (j && j.data || []).filter((s) => s.symbolType === "perpetual" && s.symbolStatus === "normal").map((s) => ({ ticker: s.symbol + ".P", description: s.baseCoin + " / " + s.quoteCoin + " Perpetual", type: "futures", base: s.baseCoin, quote: s.quoteCoin, tick: Number(s.priceEndStep || 1) * Math.pow(10, -Number(s.pricePlace || 1)) }));
}

// ONE socket per page, shared by every subscription; resubscribes on reconnect; 'ping' text every 30 s.
var hub = {
  ws: null, subs: /* @__PURE__ */ new Map(), timer: null, ping: null, retry: 0,
  key: (a) => a.instType + "|" + a.channel + "|" + a.instId,
  add(arg, cb) {
    var k = hub.key(arg);
    var e = hub.subs.get(k);
    if (!e) {
      e = { arg, cbs: /* @__PURE__ */ new Set() };
      hub.subs.set(k, e);
      hub.send({ op: "subscribe", args: [arg] });
    }
    e.cbs.add(cb);
    hub.open();
    return () => {
      e.cbs.delete(cb);
      if (!e.cbs.size && hub.subs.get(k) === e) {
        hub.subs.delete(k);
        hub.send({ op: "unsubscribe", args: [arg] });
      }
      if (!hub.subs.size) hub.close();
    };
  },
  send(o) {
    try {
      if (hub.ws && hub.ws.readyState === 1) hub.ws.send(JSON.stringify(o));
    } catch {
    }
  },
  open() {
    if (hub.ws || typeof WebSocket === "undefined") return;
    var ws = new WebSocket(WS_URL);
    hub.ws = ws;
    ws.onopen = () => {
      hub.retry = 0;
      var args = [...hub.subs.values()].map((e) => e.arg);
      if (args.length) hub.send({ op: "subscribe", args });
      hub.ping = setInterval(() => { try { ws.send("ping"); } catch {} }, 3e4);
    };
    ws.onmessage = (ev) => {
      if (typeof ev.data !== "string" || ev.data === "pong") return;
      var msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (!msg.arg) return;
      var e = hub.subs.get(hub.key(msg.arg));
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

var BitgetProvider = class {
  constructor() {
    this.symbolsPromise = null;
  }
  info() {
    return {
      name: "bitget",
      displayName: "Bitget",
      requiresApiKey: false,
      supportedTimeframes: SUPPORTED_TIMEFRAMES,
      capabilities: { enumerate: true, stream: true, symbolInfo: true }
    };
  }
  async getBars(ticker, timeframe, range) {
    try {
      var { sym, perp } = parseTicker(ticker);
      var tf = normalizeTf(timeframe);
      var nat = nativeOf(tf);
      if (nat) return dedupeSorted(await this.fetchBars(sym, perp, nat, tfMs(tf), range));
      var targetMin = /^\d+$/.test(tf) ? parseInt(tf, 10) : null;
      var subMin = targetMin != null ? selectSubTf(targetMin) : null;
      if (targetMin == null || subMin == null) {
        console.warn('[vela] Bitget: timeframe "' + timeframe + '" is not supported and cannot be aggregated.');
        return [];
      }
      var ratio = targetMin / subMin;
      var subRange = { ...range, limit: range.limit != null ? range.limit * ratio + ratio : void 0 };
      var sub = await this.fetchBars(sym, perp, NATIVE[subMin], subMin * 6e4, subRange);
      var agg = aggregate(dedupeSorted(sub), targetMin * 6e4);
      return range.limit != null && agg.length > range.limit ? agg.slice(-range.limit) : agg;
    } catch (e) {
      console.warn("[vela] Bitget: failed to fetch " + ticker + " " + timeframe + " \u2014 " + (e instanceof Error ? e.message : String(e)));
      return [];
    }
  }
  /** Newest `limit` bars (or everything since range.from), walking backwards: /candles first (up to 1000 a call),
   *  /history-candles (200 a call) once the recent window runs out. */
  async fetchBars(sym, perp, nat, ms, range) {
    var end = range.to ?? Date.now();
    var need = range.limit ?? (range.from != null ? Math.ceil((end - range.from) / ms) + 2 : 500);
    var out = [];
    var cursor = range.to != null ? range.to : void 0;
    var hist = false;
    var guard = Math.ceil(need / 200) + 8;
    while (out.length < need && guard-- > 0) {
      var size = Math.min(need - out.length, hist ? 200 : 1e3);
      var rows = await this.chunk(sym, perp, nat, size, cursor, hist);
      if (!rows.length) {
        if (hist) break;
        hist = true;
        if (cursor == null) break;
        continue;
      }
      out = rows.concat(out);
      cursor = rows[0].time - 1;
      if (range.from != null && rows[0].time <= range.from) break;
      if (rows.length < size && hist) break;
      if (rows.length < size && !hist) hist = true;
    }
    if (range.from != null) out = out.filter((b) => b.time >= range.from);
    return out.length > need ? out.slice(-need) : out;
  }
  async chunk(sym, perp, nat, limit, endTime, hist) {
    var p = new URLSearchParams({ symbol: sym, granularity: perp ? nat[1] : nat[0], limit: String(limit) });
    if (perp) p.set("productType", PROD);
    if (endTime != null) p.set("endTime", String(Math.floor(endTime)));
    var path = (perp ? "/mix" : "/spot") + "/market/" + (hist ? "history-candles" : "candles");
    var j = await this.json(REST + path + "?" + p);
    return Array.isArray(j.data) ? j.data.map(rowToOHLCV) : [];
  }
  async getSymbolInfo(ticker) {
    var t = ticker.trim().toUpperCase();
    var list = await this.listSymbols().catch(() => []);
    var s = list.find((x) => x.ticker === t);
    if (!s) return void 0;
    return {
      ticker, tickerid: "BITGET:" + ticker, prefix: "BITGET", description: s.description, type: s.type,
      basecurrency: s.base, currency: s.quote, mintick: s.tick, pricescale: Math.round(1 / s.tick), timezone: "Etc/UTC", session: "24x7"
    };
  }
  listSymbols() {
    if (!this.symbolsPromise) {
      this.symbolsPromise = Promise.all([
        this.json(REST + "/spot/public/symbols").then(parseSpotSymbols).catch(() => []),
        this.json(REST + "/mix/market/contracts?productType=" + PROD).then(parsePerpSymbols).catch(() => [])
      ]).then(([a, b]) => [...a, ...b]);
    }
    return this.symbolsPromise;
  }
  resolveSymbolIcon(symbol) {
    return ledgerCryptoIconUrl(baseOf(symbol));
  }
  subscribe(ticker, timeframe, onBar) {
    var { sym, perp } = parseTicker(ticker);
    var nat = nativeOf(normalizeTf(timeframe));
    if (nat && nat[2] && typeof WebSocket !== "undefined") return this.stream(ticker, timeframe, sym, perp, nat[2], onBar);
    return this.pollBars(ticker, timeframe, onBar);
  }
  stream(ticker, timeframe, sym, perp, channel, onBar) {
    var closed = false, stall = null, polling = null, off = null;
    var fall = () => {
      if (closed || polling) return;
      if (off) off();
      off = null;
      console.warn("[vela] Bitget: " + ticker + " " + timeframe + " stream delivered no data; falling back to polling.");
      polling = this.pollBars(ticker, timeframe, onBar);
    };
    stall = setTimeout(fall, STREAM_STALL_MS);
    off = hub.add({ instType: perp ? PROD : "SPOT", channel, instId: sym }, (msg) => {
      if (closed || polling) return;
      var bars = wsCandles(msg);
      if (bars.length) clearTimeout(stall);
      bars.forEach(onBar);
    });
    return () => {
      closed = true;
      clearTimeout(stall);
      if (off) off();
      polling?.();
    };
  }
  pollBars(ticker, timeframe, onBar) {
    var stopped = false, timer = null;
    var poll = async () => {
      if (stopped) return;
      try { (await this.getBars(ticker, timeframe, { limit: 2 })).forEach((b) => onBar(b)); } catch {}
      if (!stopped) timer = setTimeout(() => void poll(), 3e3);
    };
    timer = setTimeout(() => void poll(), 3e3);
    return () => { stopped = true; if (timer) clearTimeout(timer); };
  }
  async json(url) {
    var res = await fetch(url);
    if (!res.ok) throw new Error("Bitget HTTP " + res.status);
    var j = await res.json();
    if (j && j.code && j.code !== "00000") throw new Error("Bitget " + j.code + " " + j.msg);
    return j;
  }
};

export { BitgetProvider, rowToOHLCV, wsCandles, parseSpotSymbols, parsePerpSymbols, parseTicker };
