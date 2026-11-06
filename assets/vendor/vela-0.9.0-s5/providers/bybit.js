import { ledgerCryptoIconUrl, baseOf } from '../chunk-W4EJWLEO.js';

// TradeZoro: Bybit v5 public market data (no keys). Same shape as providers/binance.js.
// Tickers: "BTCUSDT" = spot, "BTCUSDT.P" = USDT linear perpetual. Prefix BYBIT:.
var REST = "https://api.bybit.com/v5/market";
var WS = "wss://stream.bybit.com/v5/public/";
var STREAM_STALL_MS = 15e3;
var STREAM_RECONNECT_MS = 2e3;
var PAGE = 1e3;
var TF_TO_INTERVAL = { "1": "1", "3": "3", "5": "5", "15": "15", "30": "30", "60": "60", "120": "120", "240": "240", "360": "360", "720": "720", D: "D", W: "W", M: "M" };
var TF_NORMALIZE = { "1m": "1", "3m": "3", "5m": "5", "15m": "15", "30m": "30", "45m": "45", "1h": "60", "2h": "120", "3h": "180", "4h": "240", "6h": "360", "8h": "480", "12h": "720", "1d": "D", "1w": "W", "1mo": "M", "1D": "D", "1W": "W", "4H": "240", D: "D", W: "W", M: "M" };
var NATIVE_MINUTES = [1, 3, 5, 15, 30, 60, 120, 240, 360, 720];
var SUPPORTED_TIMEFRAMES = ["1", "3", "5", "15", "30", "45", "60", "120", "180", "240", "360", "720", "D", "W", "M"];
var TF_MS = { D: 864e5, W: 6048e5, M: 2592e6 };
function tfMs(tf) {
  if (TF_MS[tf]) return TF_MS[tf];
  var min = parseInt(tf, 10);
  return Number.isFinite(min) && min > 0 ? min * 6e4 : 36e5;
}
function normalizeTf(tf) {
  return TF_NORMALIZE[tf] ?? TF_NORMALIZE[tf.toLowerCase()] ?? tf;
}
function parseTicker(ticker) {
  var t = ticker.trim().toUpperCase();
  if (t.endsWith(".P")) return { symbol: t.slice(0, -2), category: "linear" };
  return { symbol: t, category: "spot" };
}
// REST kline row: [startMs, open, high, low, close, volume, turnover], newest first.
function rowToBar(k) {
  return { time: Number(k[0]), open: Number(k[1]), high: Number(k[2]), low: Number(k[3]), close: Number(k[4]), volume: Number(k[5]) };
}
// WS kline item: { start, open, high, low, close, volume, confirm, ... }
function wsKlineToBar(k) {
  return { time: Number(k.start), open: Number(k.open), high: Number(k.high), low: Number(k.low), close: Number(k.close), volume: Number(k.volume) };
}
function dedupeSorted(bars) {
  var byTime = /* @__PURE__ */ new Map();
  for (var b of bars) byTime.set(b.time, b);
  return [...byTime.values()].sort((a, b) => a.time - b.time);
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
// Instrument rows -> symbol list rows.
function parseInstruments(list, category) {
  var perp = category === "linear";
  return (list ?? []).filter((s) => s.status === "Trading" && (!perp || s.contractType === "LinearPerpetual" && s.quoteCoin === "USDT")).map((s) => ({ ticker: perp ? s.symbol + ".P" : s.symbol, description: `${s.baseCoin} / ${s.quoteCoin}${perp ? " Perpetual" : ""}`, type: perp ? "futures" : "crypto" }));
}

// One socket per category (spot / linear) per page, shared by every kline subscription. Re-subscribes on reconnect.
var hubs = {};
function hub(category) {
  if (hubs[category]) return hubs[category];
  var h = { ws: null, topics: /* @__PURE__ */ new Map(), ping: null, retry: null, n: 0 };
  var send = (o) => {
    try {
      if (h.ws && h.ws.readyState === 1) h.ws.send(JSON.stringify(o));
    } catch {
    }
  };
  var close = () => {
    clearInterval(h.ping);
    h.ping = null;
    clearTimeout(h.retry);
    h.retry = null;
    var w = h.ws;
    h.ws = null;
    try {
      w && w.close();
    } catch {
    }
  };
  var open = () => {
    if (h.ws || !h.topics.size || typeof WebSocket === "undefined") return;
    var ws = new WebSocket(WS + category);
    h.ws = ws;
    ws.onopen = () => {
      h.n = 0;
      send({ op: "subscribe", args: [...h.topics.keys()] });
      h.ping = setInterval(() => send({ op: "ping" }), 2e4);
    };
    ws.onmessage = (ev) => {
      try {
        var msg = JSON.parse(typeof ev.data === "string" ? ev.data : "");
        var subs = msg.topic && h.topics.get(msg.topic);
        if (subs && Array.isArray(msg.data)) for (var k of msg.data) for (var f of [...subs]) f(wsKlineToBar(k));
      } catch {
      }
    };
    ws.onclose = () => {
      if (h.ws !== ws) return;
      clearInterval(h.ping);
      h.ping = null;
      h.ws = null;
      if (h.topics.size) h.retry = setTimeout(open, Math.min(3e4, STREAM_RECONNECT_MS * Math.pow(2, h.n++)));
    };
    ws.onerror = () => {
      try {
        ws.close();
      } catch {
      }
    };
  };
  h.add = (topic, fn) => {
    var set = h.topics.get(topic);
    if (!set) {
      h.topics.set(topic, set = /* @__PURE__ */ new Set());
      send({ op: "subscribe", args: [topic] });
    }
    set.add(fn);
    open();
  };
  h.del = (topic, fn) => {
    var set = h.topics.get(topic);
    if (!set) return;
    set.delete(fn);
    if (!set.size) {
      h.topics.delete(topic);
      send({ op: "unsubscribe", args: [topic] });
    }
    if (!h.topics.size) close();
  };
  return hubs[category] = h;
}

var BybitProvider = class {
  constructor() {
    this.symbolsPromise = null;
    this.rateUntil = 0;
  }
  info() {
    return { name: "bybit", displayName: "Bybit", requiresApiKey: false, supportedTimeframes: SUPPORTED_TIMEFRAMES, capabilities: { enumerate: true, stream: true, symbolInfo: true } };
  }
  async getBars(ticker, timeframe, range) {
    try {
      var { symbol, category } = parseTicker(ticker);
      var tf = normalizeTf(timeframe);
      var native = TF_TO_INTERVAL[tf];
      if (native) return dedupeSorted((await this.fetchKlines(category, symbol, native, tfMs(tf), range)).map(rowToBar));
      var targetMin = /^\d+$/.test(tf) ? parseInt(tf, 10) : null;
      var subMin = targetMin != null ? selectSubTf(targetMin) : null;
      if (targetMin == null || subMin == null) {
        console.warn(`[vela] Bybit: timeframe "${timeframe}" is not supported and cannot be aggregated.`);
        return [];
      }
      var ratio = targetMin / subMin;
      var subRange = { ...range, limit: range.limit != null ? range.limit * ratio + ratio : void 0 };
      var sub = (await this.fetchKlines(category, symbol, String(subMin), subMin * 6e4, subRange)).map(rowToBar);
      var agg = aggregate(dedupeSorted(sub), targetMin * 6e4);
      return range.limit != null && agg.length > range.limit ? agg.slice(-range.limit) : agg;
    } catch (e) {
      console.warn(`[vela] Bybit: failed to fetch ${ticker} ${timeframe} \u2014 ${e instanceof Error ? e.message : String(e)}`);
      return [];
    }
  }
  async getSymbolInfo(ticker) {
    var { symbol, category } = parseTicker(ticker);
    var data = await this.json(`${REST}/instruments-info?category=${category}&symbol=${symbol}`).catch(() => null);
    var s = data?.result?.list?.[0];
    if (!s) return void 0;
    var perp = category === "linear";
    var tick = parseFloat(s.priceFilter?.tickSize ?? "0.01") || 0.01;
    return { ticker, tickerid: `BYBIT:${ticker}`, prefix: "BYBIT", description: `${s.baseCoin} / ${s.quoteCoin}${perp ? " Perpetual" : ""}`, type: perp ? "futures" : "crypto", basecurrency: s.baseCoin, currency: s.quoteCoin, mintick: tick, pricescale: Math.round(1 / tick), timezone: "Etc/UTC", session: "24x7" };
  }
  listSymbols() {
    if (!this.symbolsPromise) this.symbolsPromise = Promise.all([this.listCategory("spot").catch(() => []), this.listCategory("linear").catch(() => [])]).then(([a, b]) => [...a, ...b]);
    return this.symbolsPromise;
  }
  resolveSymbolIcon(symbol) {
    return ledgerCryptoIconUrl(baseOf(symbol));
  }
  subscribe(ticker, timeframe, onBar) {
    var { symbol, category } = parseTicker(ticker);
    var interval = TF_TO_INTERVAL[normalizeTf(timeframe)];
    if (interval && typeof WebSocket !== "undefined") return this.streamKlines(ticker, timeframe, symbol, category, interval, onBar);
    return this.pollBars(ticker, timeframe, onBar);
  }
  streamKlines(ticker, timeframe, symbol, category, interval, onBar) {
    var closed = false, polling = null, stall = null;
    var topic = `kline.${interval}.${symbol}`;
    var h = hub(category);
    var fn = (b) => {
      if (closed || polling) return;
      clearTimeout(stall);
      stall = null;
      onBar(b);
    };
    stall = setTimeout(() => {
      if (closed || polling) return;
      h.del(topic, fn);
      console.warn(`[vela] Bybit: ${ticker} ${timeframe} stream delivered no data; falling back to polling.`);
      polling = this.pollBars(ticker, timeframe, onBar);
    }, STREAM_STALL_MS);
    h.add(topic, fn);
    return () => {
      closed = true;
      clearTimeout(stall);
      polling?.();
      h.del(topic, fn);
    };
  }
  pollBars(ticker, timeframe, onBar) {
    var stopped = false, timer = null;
    var poll = async () => {
      if (stopped) return;
      try {
        for (var b of await this.getBars(ticker, timeframe, { limit: 2 })) onBar(b);
      } catch {
      }
      if (!stopped) timer = setTimeout(() => void poll(), 3e3);
    };
    timer = setTimeout(() => void poll(), 3e3);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }
  async listCategory(category) {
    var out = [], cursor = "", guard = 10;
    while (guard-- > 0) {
      var d = await this.json(`${REST}/instruments-info?category=${category}&limit=1000${cursor ? "&cursor=" + encodeURIComponent(cursor) : ""}`);
      out.push(...parseInstruments(d?.result?.list, category));
      cursor = d?.result?.nextPageCursor || "";
      if (!cursor) break;
    }
    return out;
  }
  // Rows newest-first; pages backwards (1000 per call) from `to` until `limit` rows or the window start (`from`) is covered.
  async fetchKlines(category, symbol, interval, intervalMs, range) {
    var end = range.to ?? Date.now();
    var start = range.from;
    var limit = range.limit ?? (start != null ? Infinity : 500);
    var rows = [], guard = 40;
    while (rows.length < limit && guard-- > 0) {
      var size = Math.min(PAGE, limit - rows.length);
      var q = `${REST}/kline?category=${category}&symbol=${symbol}&interval=${interval}&limit=${size}&end=${Math.floor(end)}` + (start != null ? `&start=${Math.floor(start)}` : "");
      var chunk = (await this.json(q))?.result?.list ?? [];
      if (!chunk.length) break;
      rows.push(...chunk);
      end = Number(chunk[chunk.length - 1][0]) - 1;
      if (chunk.length < size) break;
    }
    return rows.reverse();
  }
  // Backs off on HTTP 429 / retCode 10006 (rate limit) and retries once.
  async json(url) {
    var wait = this.rateUntil - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    for (var attempt = 0; attempt < 2; attempt++) {
      var res = await fetch(url);
      if (res.status === 429) {
        this.rateUntil = Date.now() + 1500 * (attempt + 1);
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
        continue;
      }
      if (!res.ok) throw new Error(`Bybit HTTP ${res.status}`);
      var j = await res.json();
      if (j.retCode === 10006) {
        this.rateUntil = Date.now() + 1500;
        await new Promise((r) => setTimeout(r, 1500));
        continue;
      }
      if (j.retCode && j.retCode !== 0) throw new Error(`Bybit ${j.retCode} ${j.retMsg}`);
      return j;
    }
    throw new Error("Bybit rate limited");
  }
};

export { BybitProvider, rowToBar, wsKlineToBar, parseInstruments, parseTicker, aggregate };
