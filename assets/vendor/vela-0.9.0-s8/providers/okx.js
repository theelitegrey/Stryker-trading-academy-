import { ledgerCryptoIconUrl, baseOf } from '../chunk-W4EJWLEO.js';

// TradeZoro: OKX provider (spot + linear/USDT-margined perpetual swaps). Public v5 endpoints, no keys, straight from the browser.
// Shape follows providers/binance.js + hyperliquid.js. Tickers: "BTC-USDT" (spot), "BTC-USDT-SWAP" (perpetual).
//   REST  https://www.okx.com/api/v5/market/candles (latest 300) + /history-candles (older, 100 per page)
//   WS    wss://ws.okx.com:8443/ws/v5/business  (candle1m ... channels), ONE shared socket per page, resubscribed on reconnect
var REST = "https://www.okx.com/api/v5";
var WS_URL = "wss://ws.okx.com:8443/ws/v5/business";
var STREAM_STALL_MS = 15e3;
var PAGE_GAP_MS = 120; // history-candles allows 20 requests / 2 s per IP
var MAX_PAGES = 60;
var BAR_OF_MIN = { 1: "1m", 3: "3m", 5: "5m", 15: "15m", 30: "30m", 60: "1H", 120: "2H", 240: "4H", 360: "6H", 720: "12H" };
var BAR_OF_TF = { D: "1D", W: "1W", M: "1M" };
var NATIVE_MINUTES = [1, 3, 5, 15, 30, 60, 120, 240, 360, 720];
var SUPPORTED_TIMEFRAMES = ["1", "3", "5", "15", "30", "45", "60", "120", "180", "240", "360", "480", "720", "D", "W", "M"];
var TF_NORMALIZE = { "1m": "1", "3m": "3", "5m": "5", "15m": "15", "30m": "30", "45m": "45", "1h": "60", "2h": "120", "3h": "180", "4h": "240", "6h": "360", "8h": "480", "12h": "720", "1d": "D", "1w": "W", "1mo": "M", "1D": "D", "1W": "W", "4H": "240", D: "D", W: "W", M: "M" };
var QUOTES = ["USDT", "USDC", "USD"];
function normalizeTf(tf) {
  return TF_NORMALIZE[tf] ?? TF_NORMALIZE[String(tf).toLowerCase()] ?? tf;
}
function tfMs(tf) {
  if (tf === "D") return 864e5;
  if (tf === "W") return 6048e5;
  if (tf === "M") return 2592e6;
  const m = parseInt(tf, 10);
  return Number.isFinite(m) && m > 0 ? m * 6e4 : 36e5;
}
function barOf(tf) {
  return BAR_OF_TF[tf] ?? (/^\d+$/.test(tf) ? BAR_OF_MIN[parseInt(tf, 10)] : void 0);
}
/** "BTC-USDT-SWAP" | "BTC-USDT" | "BTCUSDT" | "BTCUSDT.P" -> { instId, isSwap } */
function parseTicker(ticker) {
  let t = String(ticker).trim().toUpperCase();
  let swap = false;
  if (t.endsWith("-SWAP")) {
    swap = true;
    t = t.slice(0, -5);
  } else if (t.endsWith(".P")) {
    swap = true;
    t = t.slice(0, -2);
  }
  if (!t.includes("-")) {
    const m = /^(.+?)(USDT|USDC|USD)$/.exec(t);
    if (m && m[1]) t = m[1] + "-" + m[2];
  }
  return { instId: swap ? t + "-SWAP" : t, isSwap: swap };
}
/** One OKX candle row [ts,o,h,l,c,vol,volCcy,volCcyQuote,confirm] -> bar. Swap `vol` is contracts, `volCcy` is the base coin. */
function rowToBar(k, isSwap) {
  return { time: Number(k[0]), open: Number(k[1]), high: Number(k[2]), low: Number(k[3]), close: Number(k[4]), volume: Number(isSwap ? k[6] : k[5]) };
}
function rowsToBars(rows, isSwap) {
  return dedupeSorted((rows || []).map((r) => rowToBar(r, isSwap)));
}
function dedupeSorted(bars) {
  const byTime = /* @__PURE__ */ new Map();
  for (const b of bars) byTime.set(b.time, b);
  return [...byTime.values()].sort((a, b) => a.time - b.time);
}
function aggregate(sub, bucketMs) {
  const buckets = /* @__PURE__ */ new Map();
  for (const b of sub) {
    const key = Math.floor(b.time / bucketMs) * bucketMs;
    const cur = buckets.get(key);
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
/** instruments payload -> picker rows. Spot: USDT/USDC/USD quotes. Swap: linear contracts only. */
function listFromInstruments(spotJson, swapJson) {
  const out = [];
  for (const s of spotJson?.data ?? []) {
    if (s.state === "live" && QUOTES.includes(s.quoteCcy)) out.push({ ticker: s.instId, description: `${s.baseCcy} / ${s.quoteCcy}`, type: "crypto" });
  }
  for (const s of swapJson?.data ?? []) {
    if (s.state === "live" && s.ctType === "linear") {
      const [base, quote] = s.instId.split("-");
      out.push({ ticker: s.instId, description: `${base} / ${quote} Perpetual`, type: "futures" });
    }
  }
  return out;
}
var sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// One shared WebSocket for every candle subscription on the page (OKX: 3 connections / s / IP, 480 subs / h).
var hub = { ws: null, subs: /* @__PURE__ */ new Map(), retry: 0, timer: null, ping: null, dog: null };
function hubSend(o) {
  try {
    if (hub.ws && hub.ws.readyState === 1) hub.ws.send(JSON.stringify(o));
  } catch {
  }
}
function hubOpen() {
  if (hub.ws || typeof WebSocket === "undefined" || !hub.subs.size) return;
  const ws = hub.ws = new WebSocket(WS_URL);
  ws.onopen = () => {
    hub.retry = 0;
    for (const key of hub.subs.keys()) hubSend({ op: "subscribe", args: [argOf(key)] });
    hub.ping = setInterval(() => {
      try {
        ws.send("ping");
      } catch {
      }
    }, 2e4);
  };
  ws.onmessage = (ev) => {
    if (typeof ev.data !== "string" || ev.data === "pong") return;
    let m;
    try {
      m = JSON.parse(ev.data);
    } catch {
      return;
    }
    if (!m.arg || !m.data || !String(m.arg.channel).startsWith("candle")) return;
    const key = m.arg.channel + "|" + m.arg.instId;
    const set = hub.subs.get(key);
    if (!set) return;
    for (const row of m.data) for (const cb of set) cb(row);
  };
  ws.onclose = () => {
    clearInterval(hub.ping);
    hub.ws = null;
    if (hub.subs.size) hub.timer = setTimeout(hubOpen, Math.min(15e3, 1e3 * Math.pow(2, hub.retry++)));
  };
  ws.onerror = () => {
    try {
      ws.close();
    } catch {
    }
  };
}
function argOf(key) {
  const [channel, instId] = key.split("|");
  return { channel, instId };
}
function hubSub(channel, instId, cb) {
  const key = channel + "|" + instId;
  let set = hub.subs.get(key);
  if (!set) {
    set = /* @__PURE__ */ new Set();
    hub.subs.set(key, set);
    if (hub.ws && hub.ws.readyState === 1) hubSend({ op: "subscribe", args: [argOf(key)] });
  }
  set.add(cb);
  hubOpen();
  return () => {
    set.delete(cb);
    if (!set.size) {
      hub.subs.delete(key);
      hubSend({ op: "unsubscribe", args: [argOf(key)] });
    }
    if (!hub.subs.size) {
      clearTimeout(hub.timer);
      try {
        hub.ws && hub.ws.close();
      } catch {
      }
      hub.ws = null;
    }
  };
}

var OkxProvider = class {
  constructor() {
    this.symbolsPromise = null;
  }
  info() {
    return {
      name: "okx",
      displayName: "OKX",
      requiresApiKey: false,
      supportedTimeframes: SUPPORTED_TIMEFRAMES,
      capabilities: { enumerate: true, stream: true, symbolInfo: true }
    };
  }
  async getBars(ticker, timeframe, range) {
    try {
      const { instId, isSwap } = parseTicker(ticker);
      const tf = normalizeTf(timeframe);
      const bar = barOf(tf);
      if (bar) return await this.fetchBars(instId, isSwap, bar, range);
      const targetMin = /^\d+$/.test(tf) ? parseInt(tf, 10) : null;
      const subMin = targetMin != null ? selectSubTf(targetMin) : null;
      if (targetMin == null || subMin == null) {
        console.warn(`[vela] OKX: timeframe "${timeframe}" is not supported and cannot be aggregated.`);
        return [];
      }
      const ratio = targetMin / subMin;
      const subRange = { ...range, limit: range.limit != null ? range.limit * ratio + ratio : void 0 };
      const sub = await this.fetchBars(instId, isSwap, BAR_OF_MIN[subMin], subRange);
      const agg = aggregate(sub, targetMin * 6e4);
      return range.limit != null && agg.length > range.limit ? agg.slice(-range.limit) : agg;
    } catch (e) {
      console.warn(`[vela] OKX: failed to fetch ${ticker} ${timeframe} \u2014 ${e instanceof Error ? e.message : String(e)}`);
      return [];
    }
  }
  /** Newest page from /candles (300, includes the forming bar), older pages from /history-candles (100, `after` = older than ts). */
  async fetchBars(instId, isSwap, bar, range) {
    const want = range.limit ?? 500;
    const stopAt = range.from ?? 0;
    let rows = [];
    let cursor = null;
    if (range.to == null) {
      rows = await this.get(`/market/candles?instId=${instId}&bar=${bar}&limit=300`);
      if (rows.length) cursor = rows[rows.length - 1][0];
    } else cursor = String(Number(range.to) + 1);
    let pages = 0;
    while (cursor != null && pages++ < MAX_PAGES) {
      const have = rows.length;
      const oldest = rows.length ? Number(rows[rows.length - 1][0]) : Infinity;
      if (range.from == null && have >= want) break;
      if (range.from != null && oldest <= stopAt) break;
      await sleep(PAGE_GAP_MS);
      const page = await this.get(`/market/history-candles?instId=${instId}&bar=${bar}&limit=100&after=${cursor}`);
      if (!page.length) break;
      rows = rows.concat(page);
      cursor = page[page.length - 1][0];
    }
    let bars = rowsToBars(rows, isSwap);
    if (range.from != null) bars = bars.filter((b) => b.time >= stopAt);
    if (range.to != null) bars = bars.filter((b) => b.time <= range.to);
    return range.from == null && bars.length > want ? bars.slice(-want) : bars;
  }
  async getSymbolInfo(ticker) {
    const { instId, isSwap } = parseTicker(ticker);
    const j = await this.getRaw(`/public/instruments?instType=${isSwap ? "SWAP" : "SPOT"}&instId=${instId}`).catch(() => null);
    const s = j?.data?.[0];
    if (!s) return void 0;
    const tick = parseFloat(s.tickSz) || 0.01;
    const base = isSwap ? instId.split("-")[0] : s.baseCcy;
    const quote = isSwap ? instId.split("-")[1] : s.quoteCcy;
    return {
      ticker,
      tickerid: `OKX:${ticker}`,
      prefix: "OKX",
      description: `${base} / ${quote}${isSwap ? " Perpetual" : ""}`,
      type: isSwap ? "futures" : "crypto",
      basecurrency: base,
      currency: quote,
      mintick: tick,
      pricescale: Math.round(1 / tick),
      timezone: "Etc/UTC",
      session: "24x7"
    };
  }
  listSymbols() {
    if (!this.symbolsPromise) {
      this.symbolsPromise = Promise.all([
        this.getRaw("/public/instruments?instType=SPOT").catch(() => null),
        this.getRaw("/public/instruments?instType=SWAP").catch(() => null)
      ]).then(([spot, swap]) => listFromInstruments(spot, swap));
    }
    return this.symbolsPromise;
  }
  resolveSymbolIcon(symbol) {
    return ledgerCryptoIconUrl(baseOf(symbol));
  }
  subscribe(ticker, timeframe, onBar) {
    const { instId, isSwap } = parseTicker(ticker);
    const tf = normalizeTf(timeframe);
    const bar = barOf(tf);
    if (!bar || typeof WebSocket === "undefined") return this.pollBars(ticker, timeframe, onBar);
    let polling = null;
    let stall = setTimeout(() => {
      if (polling) return;
      console.warn(`[vela] OKX: ${ticker} ${timeframe} stream delivered no data; falling back to polling.`);
      unsub();
      polling = this.pollBars(ticker, timeframe, onBar);
    }, STREAM_STALL_MS);
    const unsub = hubSub("candle" + bar, instId, (row) => {
      clearTimeout(stall);
      onBar(rowToBar(row, isSwap));
    });
    return () => {
      clearTimeout(stall);
      unsub();
      polling?.();
    };
  }
  pollBars(ticker, timeframe, onBar) {
    let stopped = false;
    let timer = null;
    const poll = async () => {
      if (stopped) return;
      try {
        const bars = await this.getBars(ticker, timeframe, { limit: 2 });
        for (const b of bars) onBar(b);
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
  async getRaw(path, tries = 3) {
    for (let i = 0; ; i++) {
      const res = await fetch(REST + path);
      if (res.status === 429 && i < tries) {
        await sleep(500 * Math.pow(2, i));
        continue;
      }
      if (!res.ok) throw new Error(`OKX HTTP ${res.status}`);
      const j = await res.json();
      if (j.code === "50011" && i < tries) {
        await sleep(500 * Math.pow(2, i));
        continue;
      }
      if (j.code !== "0") throw new Error(`OKX ${j.code} ${j.msg || ""}`);
      return j;
    }
  }
  async get(path) {
    return (await this.getRaw(path)).data || [];
  }
};

export { OkxProvider, parseTicker, rowToBar, rowsToBars, listFromInstruments, aggregate, normalizeTf };
