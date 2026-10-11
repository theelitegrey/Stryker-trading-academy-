// TradeZoro — Charts: keep live candles alive across tab switches, phone sleep and network drops (ES module)
// Depends on: nothing at load. Used by assets/chart-intervals.js wrapProvider(), which every chart data
// provider (futures, fx, binance, coinbase, hyperliquid) already goes through, so this one wrapper
// covers every symbol and interval.
//
// Owner bug 2026-10-12: "whenever I move away from charts like changing tab, it freezes, candles stop
// moving and I have to refresh the page again and again." Root causes (build 509):
//   1. Futures (chart-futures-provider.js): any close of the /api/chart/stream socket (a phone tab
//      in the background, the Cloudflare bridge recycling, a network change) switched the chart to
//      REST polling FOR GOOD. The REST pages run ~10 min behind the stream, so every polled bar was
//      older than the chart's newest (streamed) bar and Vela silently dropped it as out of order:
//      the candles froze until a reload. (Fixed in the provider: it now reconnects with backoff.)
//   2. Every provider: nothing re-opened a socket that was still "open" but dead (a half-open socket
//      after a phone sleeps or switches network sends nothing and never closes). Vela's Binance /
//      Coinbase / Hyperliquid providers only watch for a socket that never delivers its FIRST candle.
//   3. Vela's own catch-up on return re-reads history from the REST source; for futures that source
//      lags, so the minutes missed while away were not filled from the stream.
//
// What this does, per live subscription:
//   - On return (visibilitychange -> visible, pageshow incl. bfcache, focus, online, Page Lifecycle
//     'resume'), when the page was away >= 1.5 s or the feed went quiet: close the old feed, open a
//     fresh one, back-fill from the newest bar the chart has (getBars from that time), then release
//     the new feed's bars in time order. Several events firing together run ONE resync.
//   - A watchdog (one setTimeout chain, no setInterval): while visible and online, a feed that has
//     delivered nothing new for 60 s is re-opened the same way; the wait doubles (to 10 min) while
//     it stays quiet, so a closed market does not churn sockets.
// Exactly one inner subscription is open at any time; unsubscribe clears every timer and listener.

const RESUME_AWAY_MS = 1500;      // away at least this long -> resync on return
const QUIET_MS = 8000;            // or the feed delivered nothing new for this long
const DEBOUNCE_MS = 1500;         // visibilitychange + pageshow + focus arrive together: one resync
const BACKFILL_WAIT_MS = 2500;    // hold the new feed at most this long for the back-fill
const BACKFILL_MAX_BARS = 1500;   // never back-fill further than this many bars
const STALL_BASE_MS = 60000, STALL_MAX_MS = 600000, WATCH_MS = 15000;

const subs = new Set();
let installed = false;
let awaySince = 0;

function hidden() { return typeof document !== 'undefined' && document.visibilityState === 'hidden'; }
function online() { return typeof navigator === 'undefined' || navigator.onLine !== false; }

function install() {
  if (installed || typeof document === 'undefined' || typeof window === 'undefined') return;
  installed = true;
  const away = () => { if (!awaySince) awaySince = Date.now(); };
  const back = (why) => {
    if (hidden()) return;
    const awayMs = awaySince ? Date.now() - awaySince : 0;
    awaySince = 0;
    subs.forEach((s) => { try { s.resume(why, awayMs); } catch (e) {} });
  };
  document.addEventListener('visibilitychange', () => { if (hidden()) away(); else back('visible'); });
  document.addEventListener('freeze', away);
  document.addEventListener('resume', () => back('resume'));
  window.addEventListener('pagehide', away);
  window.addEventListener('pageshow', (e) => back(e && e.persisted ? 'bfcache' : 'pageshow'));
  window.addEventListener('focus', () => back('focus'));
  window.addEventListener('offline', away);
  window.addEventListener('online', () => back('online'));
}

// Bar length in ms for a Vela timeframe ('1', '15', '60', 'D', 'W', 'M', '30S', '100T', ...); 0 = unknown.
export function tfMs(tf) {
  const s = String(tf || '');
  let m = /^(\d+)$/.exec(s); if (m) return Number(m[1]) * 60000;
  m = /^(\d+)S$/i.exec(s); if (m) return Number(m[1]) * 1000;
  m = /^(\d*)([DWM])$/i.exec(s);
  if (m) return (Number(m[1]) || 1) * ({ D: 864e5, W: 6048e5, M: 2592e6 })[m[2].toUpperCase()];
  return 0;
}

// open(cb) -> unsubscribe: opens one live feed delivering bars to cb.
// backfill(range) -> Promise<bars>: the provider's getBars for this ticker + timeframe.
export function liveSubscribe(open, backfill, timeframe, onBar) {
  install();
  const step = tfMs(timeframe);
  let stopped = false;
  let unsub = null;
  let gen = 0;                 // feed generation: bars from a replaced feed are ignored
  let lastTime = null;         // newest bar time handed to the chart
  let lastNewAt = Date.now();  // when a bar at or past lastTime last arrived
  let busy = false, lastResync = 0;
  let holding = null;          // queue for the new feed's bars while the back-fill runs
  let stallMs = STALL_BASE_MS, watchTm = null;

  const deliver = (b) => {
    if (stopped || !b || !Number.isFinite(b.time)) return;
    if (lastTime == null || b.time >= lastTime) { lastTime = b.time; lastNewAt = Date.now(); stallMs = STALL_BASE_MS; }
    onBar(b);
  };
  const connect = () => {
    const my = ++gen;
    try { unsub = open((b) => { if (stopped || my !== gen) return; if (holding) holding.push(b); else deliver(b); }); }
    catch (e) { unsub = null; }
  };
  const close = () => { gen++; const u = unsub; unsub = null; try { if (u) u(); } catch (e) {} };

  async function resync() {
    if (stopped || busy) return;
    busy = true; lastResync = Date.now();
    const q = holding = [];
    close();
    connect();
    try {
      if (lastTime != null) {
        const from = step ? Math.max(lastTime, Date.now() - BACKFILL_MAX_BARS * step) : lastTime;
        const got = await Promise.race([
          Promise.resolve(backfill({ from })).catch(() => []),
          new Promise((r) => setTimeout(() => r(null), BACKFILL_WAIT_MS))
        ]);
        if (!stopped && Array.isArray(got)) {
          got.slice().sort((a, b) => a.time - b.time).forEach((b) => { if (b.time >= lastTime) deliver(b); });
        }
      }
    } catch (e) { /* the new feed still runs */ }
    if (holding === q) {
      holding = null;
      q.sort((a, b) => a.time - b.time).forEach(deliver);
    }
    busy = false;
  }

  const sub = {
    resume(why, awayMs) {
      if (stopped || busy || Date.now() - lastResync < DEBOUNCE_MS) return;
      // A plain window focus (desktop, tab never hidden) only counts after a real absence.
      const quiet = why !== 'focus' && Date.now() - lastNewAt > QUIET_MS;
      if (why === 'online' || why === 'resume' || why === 'bfcache' || awayMs >= RESUME_AWAY_MS || quiet) resync();
    }
  };
  const watch = () => {
    watchTm = null;
    if (stopped) return;
    if (!hidden() && online() && !busy && Date.now() - lastNewAt > stallMs) {
      stallMs = Math.min(STALL_MAX_MS, stallMs * 2);
      lastNewAt = Date.now();
      resync();
    }
    watchTm = setTimeout(watch, WATCH_MS);
  };

  subs.add(sub);
  connect();
  watchTm = setTimeout(watch, WATCH_MS);
  return () => {
    stopped = true;
    subs.delete(sub);
    if (watchTm) clearTimeout(watchTm);
    holding = null;
    close();
  };
}
