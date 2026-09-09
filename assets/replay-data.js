/**
 * Stryker Trading Academy — Replay data layer
 *
 * Where historical candles come from, and where sessions are kept:
 *   - Crypto: Binance's public klines endpoint, straight from the browser
 *     (CORS-enabled, keyless, full history at 1-minute resolution).
 *   - Futures / indices / FX / metals / energy: Yahoo Finance via the
 *     `replayBars` Cloud Function (Yahoo has no CORS). Yahoo's intraday
 *     history is limited — 1m for the last 30 days, 5m/15m for 60 days, 1h
 *     for 2 years, daily forever — so the finest available resolution for the
 *     chosen start date is picked automatically and shown in the UI.
 *   - Your own CSV (TradingView / MT4 / MT5 exports). Nothing leaves the
 *     browser; the file is parsed and stored in IndexedDB.
 *
 * Everything loaded is cached in IndexedDB so resuming a saved session does
 * not refetch, and sessions themselves live there too (with a best-effort
 * copy under students/{uid}/replay in Firestore for cross-device resume).
 */
(function (root) {
  'use strict';

  const FN_BASE = 'https://us-central1-strykertrades-e0cd8.cloudfunctions.net/';
  const DAY = 86400000;

  // pointValue = account currency per 1.0 price move per 1 unit of size.
  // lotStep = size granularity offered in the ticket. commission = per unit per side.
  const SYMBOLS = [
    { id: 'NQ=F', label: 'NQ · Nasdaq 100 futures', group: 'Futures', src: 'yahoo', pointValue: 20, tick: 0.25, decimals: 2, lotStep: 1, commission: 2.2, unit: 'contracts' },
    { id: 'MNQ=F', label: 'MNQ · Micro Nasdaq futures', group: 'Futures', src: 'yahoo', pointValue: 2, tick: 0.25, decimals: 2, lotStep: 1, commission: 0.6, unit: 'contracts' },
    { id: 'ES=F', label: 'ES · S&P 500 futures', group: 'Futures', src: 'yahoo', pointValue: 50, tick: 0.25, decimals: 2, lotStep: 1, commission: 2.2, unit: 'contracts' },
    { id: 'MES=F', label: 'MES · Micro S&P futures', group: 'Futures', src: 'yahoo', pointValue: 5, tick: 0.25, decimals: 2, lotStep: 1, commission: 0.6, unit: 'contracts' },
    { id: 'YM=F', label: 'YM · Dow futures', group: 'Futures', src: 'yahoo', pointValue: 5, tick: 1, decimals: 0, lotStep: 1, commission: 2.2, unit: 'contracts' },
    { id: 'RTY=F', label: 'RTY · Russell 2000 futures', group: 'Futures', src: 'yahoo', pointValue: 50, tick: 0.1, decimals: 1, lotStep: 1, commission: 2.2, unit: 'contracts' },
    { id: 'GC=F', label: 'GC · Gold futures', group: 'Futures', src: 'yahoo', pointValue: 100, tick: 0.1, decimals: 1, lotStep: 1, commission: 2.5, unit: 'contracts' },
    { id: 'CL=F', label: 'CL · Crude oil futures', group: 'Futures', src: 'yahoo', pointValue: 1000, tick: 0.01, decimals: 2, lotStep: 1, commission: 2.5, unit: 'contracts' },
    { id: 'EURUSD=X', label: 'EUR/USD', group: 'Forex', src: 'yahoo', pointValue: 1, tick: 0.00001, decimals: 5, lotStep: 1000, commission: 0, unit: 'units' },
    { id: 'GBPUSD=X', label: 'GBP/USD', group: 'Forex', src: 'yahoo', pointValue: 1, tick: 0.00001, decimals: 5, lotStep: 1000, commission: 0, unit: 'units' },
    { id: 'USDJPY=X', label: 'USD/JPY', group: 'Forex', src: 'yahoo', pointValue: 0.0067, tick: 0.001, decimals: 3, lotStep: 1000, commission: 0, unit: 'units', note: 'P&L approximated in USD at ~150 ¥/$' },
    { id: 'AUDUSD=X', label: 'AUD/USD', group: 'Forex', src: 'yahoo', pointValue: 1, tick: 0.00001, decimals: 5, lotStep: 1000, commission: 0, unit: 'units' },
    { id: 'BTCUSDT', label: 'BTC/USDT', group: 'Crypto', src: 'binance', pointValue: 1, tick: 0.1, decimals: 1, lotStep: 0.001, commission: 0, unit: 'BTC' },
    { id: 'ETHUSDT', label: 'ETH/USDT', group: 'Crypto', src: 'binance', pointValue: 1, tick: 0.01, decimals: 2, lotStep: 0.01, commission: 0, unit: 'ETH' },
    { id: 'SOLUSDT', label: 'SOL/USDT', group: 'Crypto', src: 'binance', pointValue: 1, tick: 0.01, decimals: 2, lotStep: 0.1, commission: 0, unit: 'SOL' },
    { id: 'XRPUSDT', label: 'XRP/USDT', group: 'Crypto', src: 'binance', pointValue: 1, tick: 0.0001, decimals: 4, lotStep: 1, commission: 0, unit: 'XRP' },
    { id: 'CSV', label: 'My CSV file…', group: 'Your data', src: 'csv', pointValue: 1, tick: 0.01, decimals: 2, lotStep: 1, commission: 0, unit: 'units' }
  ];
  function findSymbol(id) { return SYMBOLS.find((s) => s.id === id) || null; }

  // ---- IndexedDB -------------------------------------------------------------
  let dbp = null;
  function idb() {
    if (dbp) return dbp;
    dbp = new Promise((resolve, reject) => {
      if (!root.indexedDB) { reject(new Error('IndexedDB unavailable')); return; }
      const req = root.indexedDB.open('stryker_replay', 2);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains('datasets')) d.createObjectStore('datasets');
        if (!d.objectStoreNames.contains('sessions')) d.createObjectStore('sessions', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('csv')) d.createObjectStore('csv', { keyPath: 'name' });
        if (!d.objectStoreNames.contains('snaps')) d.createObjectStore('snaps');   // chart snapshots per trade: key sessionId:posId:entry|exit
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('IndexedDB open failed'));
    });
    return dbp;
  }
  function tx(store, mode, fn) {
    return idb().then((d) => new Promise((resolve, reject) => {
      const t = d.transaction(store, mode); const s = t.objectStore(store);
      const r = fn(s); let out;
      if (r && typeof r.onsuccess !== 'undefined') { r.onsuccess = () => { out = r.result; }; r.onerror = () => reject(r.error); }
      t.oncomplete = () => resolve(out); t.onerror = () => reject(t.error); t.onabort = () => reject(t.error);
    })).catch((e) => { console.warn('replay idb:', e); return undefined; });
  }
  const store = {
    getDataset: (key) => tx('datasets', 'readonly', (s) => s.get(key)),
    putDataset: (key, val) => tx('datasets', 'readwrite', (s) => s.put(val, key)),
    listSessions: () => tx('sessions', 'readonly', (s) => s.getAll()).then((l) => (l || []).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))),
    getSession: (id) => tx('sessions', 'readonly', (s) => s.get(id)),
    putSession: (sess) => tx('sessions', 'readwrite', (s) => s.put(sess)),
    deleteSession: (id) => tx('sessions', 'readwrite', (s) => s.delete(id)),
    listCsv: () => tx('csv', 'readonly', (s) => s.getAll()).then((l) => (l || []).map((c) => ({ name: c.name, bars: c.bars.length, baseTf: c.baseTf, first: c.bars[0] && c.bars[0].t, last: c.bars[c.bars.length - 1] && c.bars[c.bars.length - 1].t }))),
    getCsv: (name) => tx('csv', 'readonly', (s) => s.get(name)),
    putCsv: (obj) => tx('csv', 'readwrite', (s) => s.put(obj)),
    deleteCsv: (name) => tx('csv', 'readwrite', (s) => s.delete(name)),
    getSnap: (key) => tx('snaps', 'readonly', (s) => s.get(key)),
    putSnap: (key, dataUrl) => tx('snaps', 'readwrite', (s) => s.put(dataUrl, key)),
    deleteSnaps: (sessionId) => tx('snaps', 'readwrite', (s) => { const r = s.openCursor(IDBKeyRange.bound(sessionId + ':', sessionId + ':\uffff')); r.onsuccess = () => { const c = r.result; if (c) { c.delete(); c.continue(); } }; return null; })
  };

  // ---- fetch helpers ---------------------------------------------------------
  function getJson(url, timeoutMs, opts) {
    const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), timeoutMs || 20000);
    return fetch(url, Object.assign({ signal: ctl.signal }, opts || {}))
      .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .finally(() => clearTimeout(to));
  }

  // The replayBars function is ours, and it fans one browser request out to as
  // many as twelve Yahoo requests. Sending the signed-in user's ID token lets
  // it charge that work to a real account instead of serving the whole
  // internet anonymously. Sent as a bearer token; the function currently
  // accepts requests without one too, so this is safe to ship before the
  // function is redeployed.
  function authHeader() {
    try {
      const user = (typeof firebase !== 'undefined' && firebase.auth) ? firebase.auth().currentUser : null;
      if (!user) return Promise.resolve(null);
      return user.getIdToken().then((t) => (t ? { Authorization: 'Bearer ' + t } : null)).catch(() => null);
    } catch (e) { return Promise.resolve(null); }
  }
  function compact(rows) { // [[t,o,h,l,c,v]] → bars
    const out = [];
    for (const r of rows) { const b = { t: Number(r[0]), o: Number(r[1]), h: Number(r[2]), l: Number(r[3]), c: Number(r[4]), v: Number(r[5]) || 0 }; if (isFinite(b.t) && isFinite(b.o) && isFinite(b.h) && isFinite(b.l) && isFinite(b.c)) out.push(b); }
    out.sort((a, b) => a.t - b.t);
    const dedup = []; for (const b of out) { if (!dedup.length || dedup[dedup.length - 1].t !== b.t) dedup.push(b); }
    return dedup;
  }

  // Binance: choose the finest interval that keeps the request count sane.
  function binanceInterval(days) { return days <= 30 ? '1m' : days <= 120 ? '5m' : days <= 365 ? '15m' : '1h'; }
  const BINANCE_MS = { '1m': 60000, '5m': 300000, '15m': 900000, '1h': 3600000 };
  const BINANCE_HOSTS = ['https://api.binance.com', 'https://data-api.binance.vision', 'https://api.binance.us'];
  async function loadBinance(sym, startMs, endMs, onProgress) {
    const days = (endMs - startMs) / DAY; const iv = binanceInterval(days); const step = BINANCE_MS[iv] * 1000;
    const rows = []; let from = startMs; let host = null; let guard = 0;
    while (from < endMs && guard++ < 400) {
      let json = null, lastErr = null;
      for (const h of host ? [host] : BINANCE_HOSTS) {
        try { json = await getJson(`${h}/api/v3/klines?symbol=${sym}&interval=${iv}&startTime=${from}&endTime=${Math.min(endMs, from + step)}&limit=1000`); host = h; break; }
        catch (e) { lastErr = e; }
      }
      if (!json) throw new Error('Binance unreachable (' + (lastErr && lastErr.message) + '). If you are in a region Binance blocks, use a CSV file instead.');
      if (!json.length) { from += step; continue; }
      for (const k of json) rows.push([k[0], k[1], k[2], k[3], k[4], k[5]]);
      from = json[json.length - 1][0] + BINANCE_MS[iv];
      if (onProgress) onProgress(Math.min(0.98, (from - startMs) / (endMs - startMs)), rows.length);
    }
    return { bars: compact(rows), baseTf: iv, source: 'Binance', note: 'Binance public klines · ' + iv + ' resolution' };
  }

  // Yahoo via Cloud Function: finest resolution available for the start date.
  function yahooInterval(startMs) {
    const age = (Date.now() - startMs) / DAY;
    if (age <= 29) return '1m';
    if (age <= 59) return '5m';
    if (age <= 729) return '1h';
    return '1d';
  }
  const YAHOO_LIMIT = { '1m': 'the last 30 days', '5m': 'the last 60 days', '1h': 'the last 2 years' };
  async function loadYahoo(sym, startMs, endMs, onProgress) {
    const iv = yahooInterval(startMs);
    if (onProgress) onProgress(0.1, 0);
    const headers = await authHeader();
    const json = await getJson(`${FN_BASE}replayBars?symbol=${encodeURIComponent(sym)}&interval=${iv}&period1=${Math.floor(startMs / 1000)}&period2=${Math.floor(endMs / 1000)}`,
      60000, headers ? { headers } : undefined);
    if (json.error) throw new Error(json.error);
    if (onProgress) onProgress(0.95, (json.bars || []).length);
    const bars = compact(json.bars || []);
    if (!bars.length) throw new Error('Yahoo returned no candles for that range. Intraday history is limited (1m: 30 days, 5m: 60 days, 1h: 2 years) — try a more recent start date or a CSV file.');
    const note = 'Yahoo Finance · ' + iv + ' resolution' + (YAHOO_LIMIT[iv] ? ' (finest available for ' + YAHOO_LIMIT[iv] + ')' : '');
    return { bars, baseTf: iv === '1d' ? '1D' : iv, source: 'Yahoo Finance', note };
  }

  // ---- CSV ---------------------------------------------------------------------
  function parseCsv(text) {
    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    if (lines.length < 3) throw new Error('That file has no candle rows.');
    const delim = [',', ';', '\t'].map((d) => ({ d, n: lines[0].split(d).length })).sort((a, b) => b.n - a.n)[0].d;
    const head = lines[0].split(delim).map((h) => h.trim().replace(/^"|"$/g, '').toLowerCase());
    const find = (names) => head.findIndex((h) => names.includes(h));
    let iT = find(['time', 'date', 'datetime', 'timestamp', 'gmt time', 'local time', '<date>']), iO = find(['open', '<open>']), iH = find(['high', '<high>']), iL = find(['low', '<low>']), iC = find(['close', '<close>']), iV = find(['volume', 'vol', 'vol.', '<vol>', '<tickvol>']);
    let start = 1;
    if (iO < 0 || iC < 0) { // headerless: assume time,open,high,low,close[,volume]
      const probe = lines[0].split(delim); if (probe.length >= 5 && isFinite(Number(probe[1]))) { iT = 0; iO = 1; iH = 2; iL = 3; iC = 4; iV = probe.length > 5 ? 5 : -1; start = 0; }
      else throw new Error('Could not find open/high/low/close columns. Expected a header like: time,open,high,low,close,volume');
    }
    const iD2 = find(['<time>']); // MT4/5 exports keep date and time in two columns
    const rows = [];
    for (let i = start; i < lines.length; i++) {
      const c = lines[i].split(delim).map((x) => x.trim().replace(/^"|"$/g, ''));
      let ts = c[iT]; if (iD2 >= 0) ts = ts + ' ' + c[iD2];
      const t = parseTime(ts); if (!isFinite(t)) continue;
      rows.push([t, c[iO], c[iH], c[iL], c[iC], iV >= 0 ? c[iV] : 0]);
    }
    const bars = compact(rows);
    if (bars.length < 3) throw new Error('No readable candle rows were found.');
    const E = root.ReplayEngine; const tfMs = E ? inferTf(bars) : 60000;
    const baseTf = Object.keys(E.TF).find((k) => E.TF[k] === tfMs) || '1m';
    const noTz = !/[zZ]|[+-]\d\d:?\d\d$/.test(String(lines[start].split(delim)[iT] || '')) && !/^\d{9,}$/.test(String(lines[start].split(delim)[iT] || '').trim());
    return { bars, baseTf, source: 'CSV', note: 'Your file · ' + baseTf + ' resolution' + (noTz ? ' · timestamps had no timezone, treated as UTC' : '') };
  }
  function inferTf(bars) { const gaps = {}; for (let i = 1; i < Math.min(bars.length, 500); i++) { const g = bars[i].t - bars[i - 1].t; if (g > 0) gaps[g] = (gaps[g] || 0) + 1; } let best = 60000, n = -1; for (const g in gaps) if (gaps[g] > n) { n = gaps[g]; best = Number(g); } return best; }
  function parseTime(s) {
    if (s == null) return NaN; s = String(s).trim();
    if (/^\d+(\.\d+)?$/.test(s)) { const n = Number(s); return n < 1e11 ? n * 1000 : n; }
    let iso = s.replace(/^(\d{4})[./](\d{2})[./](\d{2})/, '$1-$2-$3').replace(/^(\d{4}-\d{2}-\d{2}) /, '$1T');
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(iso)) iso += 'Z';
    if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) iso += 'T00:00:00Z';
    let t = Date.parse(iso);
    if (isNaN(t)) { const m = s.match(/^(\d{2})[./-](\d{2})[./-](\d{4})[ T](\d{2}):(\d{2})(?::(\d{2}))?/); if (m) t = Date.UTC(+m[3], +m[2] - 1, +m[1], +m[4], +m[5], +(m[6] || 0)); }
    return t;
  }

  // ---- unified loader ------------------------------------------------------------
  async function load(opts) {
    const spec = opts.spec; const key = `${spec.src}:${spec.id}:${opts.startMs}:${opts.endMs}`;
    if (spec.src !== 'csv') {
      const cached = await store.getDataset(key);
      if (cached && cached.bars && cached.bars.length) { if (opts.onProgress) opts.onProgress(1, cached.bars.length); return Object.assign({ cached: true }, cached); }
    }
    let res;
    if (spec.src === 'binance') res = await loadBinance(spec.id, opts.startMs, opts.endMs, opts.onProgress);
    else if (spec.src === 'yahoo') res = await loadYahoo(spec.id, opts.startMs, opts.endMs, opts.onProgress);
    else if (spec.src === 'csv') { const c = await store.getCsv(opts.csvName); if (!c) throw new Error('That CSV is no longer stored in this browser.'); res = { bars: c.bars.filter((b) => b.t >= opts.startMs && b.t <= opts.endMs), baseTf: c.baseTf, source: 'CSV', note: 'Your file · ' + c.baseTf + ' resolution' }; if (!res.bars.length) throw new Error('No rows in that file fall inside the chosen dates.'); }
    else throw new Error('Unknown data source');
    if (spec.src !== 'csv') store.putDataset(key, { bars: res.bars, baseTf: res.baseTf, source: res.source, note: res.note, savedAt: Date.now() });
    return res;
  }

  root.ReplayData = { SYMBOLS, findSymbol, load, parseCsv, store, FN_BASE, yahooInterval, binanceInterval };
})(window);
