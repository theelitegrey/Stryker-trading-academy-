/**
 * Stryker Trading Academy — Intel feed
 *
 * Replaces the WorldMonitor proxy. Every source here is free, keyless, and
 * usable commercially, so there is nothing to sign up for and no credential to
 * protect.
 *
 * DEPLOY from the twitter-feed-function project:
 *   firebase deploy --only functions:getTwitterFeed,functions:mirrorTweets,
 *     functions:getWorldEvents,functions:getNewswire,functions:getIntel
 *
 * SOURCES
 *   alternative.me      crypto fear & greed        no key
 *   Polymarket (gamma)  prediction market odds     no key
 *   Frankfurter (ECB)   reference FX rates         no key
 *   World Bank          country macro indicators   no key
 *   USGS                significant earthquakes    no key
 *
 * EACH SOURCE FAILS INDEPENDENTLY. They are fetched with allSettled and cached
 * separately, so one outage costs one panel. Fetching them in a single
 * try/catch would let a single slow host blank the entire tab — which is how
 * dashboards built on many free APIs usually die.
 */

const functions = require('firebase-functions');
const admin = require('firebase-admin');

// Force IPv4 for outbound fetches.
//
// Node 18+ resolves AAAA records first, and a host with a broken or unrouted
// IPv6 path fails with a bare "fetch failed" rather than falling back. GDELT is
// a long-standing academic service; assuming its IPv6 is as maintained as its
// IPv4 is optimistic. This costs nothing where IPv6 works.
const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');


const CACHE_PREFIX = 'cache/intel_';
const UA = { 'User-Agent': 'StrykerTradingAcademy/1.0 (terminal intel)' };

/**
 * Cache lifetimes reflect how fast each number actually moves, not one global
 * guess. Fear & greed recomputes daily; FX reference rates publish once a day;
 * prediction odds move continuously. Caching them all alike would either waste
 * requests on static data or show stale odds as though they were live.
 */
const SOURCES = {
  fearGreed: {
    ttl: 60,
    url: 'https://api.alternative.me/fng/?limit=1',
    parse: (j) => {
      const d = (j.data || [])[0];
      if (!d) return null;
      return { value: Number(d.value), label: d.value_classification || '' };
    }
  },

  predictions: {
    ttl: 15,
    // Ordered by liquidity: an unfiltered list is dominated by markets with a
    // few dollars in them, where the "odds" are noise rather than a signal.
    url: 'https://gamma-api.polymarket.com/markets?closed=false&order=liquidity&ascending=false&limit=40',
    parse: (j) => {
      const rows = Array.isArray(j) ? j : (j.data || []);
      return rows.map((m) => {
        // outcomePrices arrives as a JSON-encoded STRING, not an array — a
        // detail that silently yields NaN if passed straight to Number().
        let prices = m.outcomePrices;
        if (typeof prices === 'string') {
          try { prices = JSON.parse(prices); } catch (e) { prices = null; }
        }
        const p = Array.isArray(prices) ? Number(prices[0]) : null;
        return {
          question: String(m.question || m.title || '').slice(0, 120),
          probability: (p !== null && !isNaN(p)) ? p : null,
          liquidity: Number(m.liquidity) || 0
        };
      })
      .filter((m) => m.question && m.probability !== null)
      .slice(0, 8);
    }
  },

  fx: {
    ttl: 180,
    // ECB reference rates, published once each working day. Base USD so the
    // numbers read the way a dollar-quoting audience expects.
    url: 'https://api.frankfurter.app/latest?base=USD&symbols=EUR,GBP,JPY,CHF,CAD,AUD,CNY',
    parse: (j) => {
      const r = j.rates || {};
      return Object.keys(r).map((k) => ({ pair: 'USD/' + k, rate: r[k] }));
    }
  },

  macro: {
    ttl: 1440,
    // World Bank inflation, most recent non-null year per country. Free, no
    // key, and explicitly open for reuse.
    url: 'https://api.worldbank.org/v2/country/US;GB;DE;JP;CN;IN/indicator/FP.CPI.TOTL.ZG' +
         '?format=json&mrnev=1',
    parse: (j) => {
      // The World Bank wraps results as [metadata, rows] — indexing straight
      // into [0] returns the pagination header and looks like an empty result.
      const rows = Array.isArray(j) && Array.isArray(j[1]) ? j[1] : [];
      return rows.map((r) => ({
        country: (r.country && r.country.value) || r.countryiso3code || '',
        value: r.value === null ? null : Number(r.value),
        year: r.date || ''
      })).filter((r) => r.country && r.value !== null);
    }
  },

  quakes: {
    ttl: 30,
    url: 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/significant_week.geojson',
    parse: (j) => {
      return (j.features || []).map((f) => ({
        place: String((f.properties && f.properties.place) || '').slice(0, 70),
        mag: f.properties ? Number(f.properties.mag) : null,
        at: f.properties ? f.properties.time : null
      })).filter((q) => q.place && q.mag !== null).slice(0, 6);
    }
  }
};

async function fetchSource(db, key) {
  const src = SOURCES[key];
  const ref = db.doc(CACHE_PREFIX + key);

  let stale = null;
  try {
    const doc = await ref.get();
    if (doc.exists) {
      const d = doc.data();
      const age = (Date.now() - (d.fetchedAt || 0)) / 60000;
      if (age < src.ttl) return { key, value: d.body, cached: true };
      stale = d.body;
    }
  } catch (err) {
    console.warn('getIntel: cache read failed for', key, err);
  }

  try {
    // A timeout is essential, not defensive padding: without one a single
    // hanging host holds the whole function until it times out at 60s, and
    // every panel waits on the slowest.
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const r = await fetch(src.url, { headers: UA, signal: ctrl.signal });
    clearTimeout(timer);

    if (!r.ok) throw new Error(key + ' returned ' + r.status);
    const parsed = src.parse(await r.json());
    if (parsed === null || (Array.isArray(parsed) && !parsed.length)) {
      throw new Error(key + ' parsed empty');
    }

    ref.set({ body: parsed, fetchedAt: Date.now() })
       .catch((e) => console.warn('getIntel: cache write failed', key, e));
    return { key, value: parsed, cached: false };
  } catch (err) {
    console.error('getIntel:', key, describeFetchError(err));
    // Stale beats blank. A number a few hours old, shown, is more useful than
    // an empty panel that gives no indication anything was ever there.
    return { key, value: stale, cached: true, stale: true, error: true };
  }
}


/**
 * Unwrap a fetch failure into something diagnosable.
 *
 * Node's fetch throws a bare "fetch failed" and puts the real reason on
 * err.cause — ENOTFOUND, ECONNREFUSED, a TLS handshake failure and an IPv6
 * timeout all surface identically without it. Logging the message alone made
 * four very different faults indistinguishable.
 */
function describeFetchError(err) {
  const parts = [];
  if (err && err.message) parts.push(err.message);
  let cause = err && err.cause;
  let depth = 0;
  while (cause && depth < 4) {
    if (cause.code) parts.push('code=' + cause.code);
    if (cause.message && cause.message !== err.message) parts.push(cause.message);
    if (cause.errno !== undefined) parts.push('errno=' + cause.errno);
    cause = cause.cause;
    depth++;
  }
  return parts.join(' | ').slice(0, 300);
}

exports.getIntel = functions
  .runWith({ timeoutSeconds: 60, memory: '256MB' })
  .https.onRequest(async (req, res) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Cache-Control', 'public, max-age=120');
    if (req.method === 'OPTIONS') { res.status(204).send(''); return; }

    const db = admin.firestore();
    const keys = Object.keys(SOURCES);

    // allSettled, not all: one rejected source must not take the others with
    // it, and fetchSource already resolves rather than throwing.
    const settled = await Promise.allSettled(keys.map((k) => fetchSource(db, k)));

    const data = {};
    const meta = {};
    settled.forEach((s, i) => {
      const k = keys[i];
      if (s.status === 'fulfilled') {
        data[k] = s.value.value;
        meta[k] = { cached: !!s.value.cached, stale: !!s.value.stale };
      } else {
        data[k] = null;
        meta[k] = { error: true };
      }
    });

    res.json({ ok: true, data, meta });
  });
