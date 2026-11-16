// TradeZoro — Charts: connection / latency measurements (pure logic, no DOM). Owner order 15 Nov 2026.
// Depends on: nothing. Used by assets/chart-latency.js (the chip + popover), and fed by the data paths:
//   assets/chart-intervals.js  noteBar(provider:ticker)       every live bar any chart provider delivers
//   assets/chart-futures-provider.js noteExch('futures:'+ticker, t)  the stream bridge's 5 s heartbeat carries the edge's clock
//   assets/chart-tick-boost.js noteExch(provider:ticker, tradeTime)  crypto trades carry the exchange's trade time
// Honesty rules: every number shown comes from a sample taken in this browser; no sample = null (the UI shows "—").
// Exchange-time delays are corrected by the browser-vs-edge clock offset measured by /api/ping, so a wrong PC clock
// does not show up as "latency"; until the first ping lands, no delay is shown.

export const WINDOW_MS = 120000;     // samples kept (the sparkline)
export const AVG_MS = 60000;         // average + jitter window
export const PING_EVERY_MS = 5000;

const feeds = new Map();             // key -> { lastBar, delays: [[t, rawMs]], lastSampleAt }
const pings = [];                    // [[t, rttMs]]
let offset = null;                   // edge clock - browser clock (ms); null until a ping lands
let offsetRtt = Infinity;

const now = () => Date.now();
const feed = (key) => { let f = feeds.get(key); if (!f) { f = { lastBar: 0, delays: [], lastSampleAt: 0 }; feeds.set(key, f); } return f; };
const trim = (arr, t) => { while (arr.length && arr[0][0] < t - WINDOW_MS) arr.shift(); };

// One key per provider + ticker ('binance:btcusdt'); a ticker that already carries a prefix keeps only its last part.
export const feedKey = (prov, ticker) => String(prov || '').toLowerCase() + ':' + String(ticker || '').replace(/^[a-z0-9_]+:/i, '').trim().toLowerCase();

export function noteBar(key) { if (key) feed(String(key).toLowerCase()).lastBar = now(); }

// exchMs = the time the exchange (or our edge) stamped on the message. At most one sample a second per feed.
export function noteExch(key, exchMs) {
  if (!key || !Number.isFinite(exchMs)) return;
  const f = feed(String(key).toLowerCase()), t = now();   // not a "last update": a heartbeat is not a tick (noteBar is)
  if (t - f.lastSampleAt < 1000) return;
  f.lastSampleAt = t;
  f.delays.push([t, t - exchMs]);
  trim(f.delays, t);
}

// One /api/ping answer: sent at t0, received at t1 (browser clock), edge clock serverT.
export function notePing(t0, t1, serverT) {
  const rtt = t1 - t0;
  if (!(rtt >= 0)) return;
  pings.push([t1, rtt]); trim(pings, t1);
  // keep the offset from the tightest round trip seen recently (least asymmetric)
  if (Number.isFinite(serverT) && (rtt <= offsetRtt * 1.5 || pings.length < 3)) { offset = serverT - (t0 + rtt / 2); offsetRtt = Math.min(offsetRtt, rtt); }
}
export function notePingFail() { pings.push([now(), null]); trim(pings, now()); }
export const clockOffset = () => offset;

// { cur, avg, jitter, n, series: [[t, ms|null]] } over a sample list; values null when there is nothing to show
export function stats(series, t = now()) {
  const recent = series.filter((s) => s[0] >= t - AVG_MS && s[1] != null);
  const last = series.length ? series[series.length - 1] : null;
  const cur = last && last[1] != null && t - last[0] < 15000 ? last[1] : null;
  if (!recent.length) return { cur, avg: null, jitter: null, n: 0, series };
  const avg = recent.reduce((a, s) => a + s[1], 0) / recent.length;
  let j = 0; for (let i = 1; i < recent.length; i++) j += Math.abs(recent[i][1] - recent[i - 1][1]);
  return { cur, avg, jitter: recent.length > 1 ? j / (recent.length - 1) : null, n: recent.length, series };
}

export function siteStats(t = now()) {
  const s = stats(pings, t);
  // two failed pings in a row = offline
  const tail = pings.slice(-2);
  s.down = tail.length === 2 && tail.every((p) => p[1] == null);
  return s;
}

// Market feed: { lastBar, age, delay: stats over exchange->browser delays (null until the clock offset is known) }
export function feedStats(key, t = now()) {
  const f = feeds.get(String(key || '').toLowerCase());
  if (!f) return { lastBar: 0, age: null, delay: stats([], t) };
  const ser = offset == null ? [] : f.delays.map((d) => [d[0], Math.max(0, Math.round(d[1] + offset))]);
  return { lastBar: f.lastBar, age: f.lastBar ? t - f.lastBar : null, delay: stats(ser, t) };
}

// Quality from a latency in ms: green < 80, amber < 200, red above; null = no data (grey).
// feed=true: an exchange -> you delay also holds the exchange's own publish time, so its bands are wider (< 500 / < 1250).
export function quality(ms, feed) {
  if (ms == null || !Number.isFinite(ms)) return { q: 'none', word: 'No data', bars: 0 };
  const k = feed ? 6.25 : 1;
  if (ms < 40 * k) return { q: 'good', word: 'Excellent', bars: 4 };
  if (ms < 80 * k) return { q: 'good', word: 'Good', bars: 3 };
  if (ms < 200 * k) return { q: 'fair', word: 'Fair', bars: 2 };
  return { q: 'poor', word: 'Poor', bars: 1 };
}

export const fmtMs = (ms) => (ms == null || !Number.isFinite(ms) ? '—' : Math.round(ms) + ' ms');
export function fmtAge(ms) {
  if (ms == null || !Number.isFinite(ms)) return '—';
  if (ms < 10000) return (ms / 1000).toFixed(1) + ' s ago';
  if (ms < 120000) return Math.round(ms / 1000) + ' s ago';
  if (ms < 7200000) return Math.round(ms / 60000) + ' min ago';
  return Math.round(ms / 3600000) + ' h ago';
}

// Cloudflare data-centre IATA code -> city (shown as "<city> edge"). Unknown code: the code itself.
const COLO = {
  BOM: 'Mumbai', DEL: 'New Delhi', MAA: 'Chennai', BLR: 'Bengaluru', HYD: 'Hyderabad', CCU: 'Kolkata', AMD: 'Ahmedabad', COK: 'Kochi', NAG: 'Nagpur', PAT: 'Patna', IXC: 'Chandigarh', BBI: 'Bhubaneswar',
  KHI: 'Karachi', LHE: 'Lahore', ISB: 'Islamabad', DAC: 'Dhaka', CMB: 'Colombo', KTM: 'Kathmandu', DXB: 'Dubai', AUH: 'Abu Dhabi', DOH: 'Doha', BAH: 'Bahrain', KWI: 'Kuwait', MCT: 'Muscat', RUH: 'Riyadh', JED: 'Jeddah', DMM: 'Dammam', AMM: 'Amman', TLV: 'Tel Aviv', IST: 'Istanbul',
  SIN: 'Singapore', KUL: 'Kuala Lumpur', BKK: 'Bangkok', CGK: 'Jakarta', MNL: 'Manila', SGN: 'Ho Chi Minh City', HAN: 'Hanoi', HKG: 'Hong Kong', TPE: 'Taipei', NRT: 'Tokyo', KIX: 'Osaka', ICN: 'Seoul', SYD: 'Sydney', MEL: 'Melbourne', BNE: 'Brisbane', PER: 'Perth', AKL: 'Auckland',
  LHR: 'London', MAN: 'Manchester', DUB: 'Dublin', AMS: 'Amsterdam', FRA: 'Frankfurt', MUC: 'Munich', DUS: 'Düsseldorf', HAM: 'Hamburg', BER: 'Berlin', TXL: 'Berlin', CDG: 'Paris', MRS: 'Marseille', MAD: 'Madrid', BCN: 'Barcelona', LIS: 'Lisbon', MXP: 'Milan', FCO: 'Rome', ZRH: 'Zurich', GVA: 'Geneva', VIE: 'Vienna', PRG: 'Prague', WAW: 'Warsaw', BUD: 'Budapest', OTP: 'Bucharest', SOF: 'Sofia', ATH: 'Athens', CPH: 'Copenhagen', ARN: 'Stockholm', OSL: 'Oslo', HEL: 'Helsinki', BRU: 'Brussels', KBP: 'Kyiv',
  JNB: 'Johannesburg', CPT: 'Cape Town', LOS: 'Lagos', NBO: 'Nairobi', CAI: 'Cairo', CMN: 'Casablanca',
  EWR: 'Newark', JFK: 'New York', IAD: 'Ashburn', BOS: 'Boston', PHL: 'Philadelphia', ATL: 'Atlanta', MIA: 'Miami', ORD: 'Chicago', DFW: 'Dallas', IAH: 'Houston', DEN: 'Denver', PHX: 'Phoenix', LAX: 'Los Angeles', SJC: 'San Jose', SFO: 'San Francisco', SEA: 'Seattle', PDX: 'Portland', SLC: 'Salt Lake City', MSP: 'Minneapolis', DTW: 'Detroit', YYZ: 'Toronto', YUL: 'Montréal', YVR: 'Vancouver', MEX: 'Mexico City', GRU: 'São Paulo', GIG: 'Rio de Janeiro', EZE: 'Buenos Aires', SCL: 'Santiago', BOG: 'Bogotá', LIM: 'Lima'
};
export const coloCity = (code) => { const c = String(code || '').toUpperCase(); return c ? COLO[c] || c : ''; };

// tests only
export function _reset() { feeds.clear(); pings.length = 0; offset = null; offsetRtt = Infinity; }
