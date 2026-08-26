/**
 * Stryker Trading Academy — background refresh of GDELT-backed data
 *
 * Fetches world events and newswire headlines on a schedule and writes them to
 * Firestore. The user-facing functions then only ever read that cache.
 *
 * DEPLOY:
 *   firebase deploy --only functions:refreshWorldData
 *
 * WHY THIS EXISTS
 *
 * Measured from Cloud Shell, GDELT answered a single request with HTTP 429
 * after 58.9 seconds. That is the whole problem: it does not refuse quickly, it
 * queues and then refuses. A Cloud Function invoked by a student's page load
 * gives up long before that and reports "fetch failed", which is why the
 * symptom looked like a network fault rather than rate limiting.
 *
 * No timeout tuning fixes this. A request that takes a minute to be REJECTED
 * cannot sit in a user's page load at all. The only correct answer is to move
 * the fetch off the request path entirely: a background job can afford to wait
 * a minute, retry, and fail quietly, because nobody is watching it.
 *
 * This is the same shape as mirrorTweets, and should have been the shape from
 * the start — the mistake was treating a slow, aggressively rate-limited public
 * service as though it were a fast one.
 */

const functions = require('firebase-functions');
const admin = require('firebase-admin');
const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');

const UA = { 'User-Agent': 'StrykerTradingAcademy/1.0 (+https://strykertrading.com)' };

const EVENTS_QUERY = '(market OR economy OR "central bank" OR inflation OR ' +
                     'conflict OR election OR sanctions OR protest OR tariff)';
const NEWS_QUERY = '("central bank" OR inflation OR "interest rate" OR recession OR ' +
                   'stocks OR "federal reserve" OR oil OR gold OR dollar OR ' +
                   'earnings OR tariffs OR bitcoin)';

const CATEGORIES = [
  { key: 'centralbank', label: 'Central banks', colour: '#f5c542',
    re: /\b(fed|fomc|ecb|boe|boj|snb|rba|rbnz|pboc|central bank|interest rate|rate (cut|hike|decision)|monetary policy|powell|lagarde)\b/i },
  { key: 'econ', label: 'Economic data', colour: '#00adb5',
    re: /\b(inflation|cpi|ppi|gdp|unemployment|payrolls|nfp|jobless|retail sales|pmi|consumer confidence|trade balance)\b/i },
  { key: 'markets', label: 'Markets', colour: '#03c988',
    re: /\b(stocks?|shares?|equities|bond|yield|dollar|euro|sterling|currency|commodit|oil|gold|crude|nasdaq|s&p|dow|ftse|nikkei|crypto|bitcoin|earnings)\b/i },
  { key: 'conflict', label: 'Geopolitics', colour: '#e5484d',
    re: /\b(war|strikes?|attack|missile|invasion|troops|militar|conflict|ceasefire|sanction|tariff|protest|coup|unrest)\b/i },
  { key: 'politics', label: 'Politics', colour: '#8b7dd8',
    re: /\b(election|parliament|congress|senate|president|prime minister|government|policy|treaty|summit)\b/i }
];

function categorise(text) {
  for (const c of CATEGORIES) if (c.re.test(text)) return c.key;
  return 'markets';
}

/**
 * HTTPS GET returning parsed JSON, using Node's own https module.
 *
 * NOT fetch. Node's fetch is undici, which enforces its own 10-SECOND CONNECT
 * TIMEOUT that an AbortController cannot override — the observed failure was
 * exactly this:
 *
 *   code=UND_ERR_CONNECT_TIMEOUT
 *   Connect Timeout Error (attempted address: api.gdeltproject.org:443,
 *   timeout: 10000ms)
 *
 * So the 90-second abort was controlling the wrong thing: undici gave up on the
 * TCP handshake at ten seconds and the abort never came into play. GDELT is
 * evidently slow to accept connections from this network — Cloud Shell reached
 * it, Cloud Functions does not within undici's allowance.
 *
 * The https module lets the connect and idle timeouts be set explicitly, which
 * is the only way to wait longer than undici permits without adding a
 * dependency.
 */
const https = require('https');

function httpsGetJson(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: UA,
      // Generous, because GDELT has been measured taking 59 seconds simply to
      // return a rejection. A short timeout here converts a clear answer into
      // an ambiguous abort, which is what hid this fault for three rounds.
      timeout: timeoutMs
    }, (res) => {
      const status = res.statusCode;
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => {
        body += c;
        // A runaway response would otherwise fill the function's memory before
        // any timeout noticed.
        if (body.length > 12 * 1024 * 1024) {
          req.destroy(new Error('response too large'));
        }
      });
      res.on('end', () => {
        if (status === 429) { reject(Object.assign(new Error('HTTP 429'), { retry: true })); return; }
        if (status < 200 || status >= 300) {
          reject(new Error('HTTP ' + status + ': ' + body.slice(0, 150)));
          return;
        }
        try { resolve(JSON.parse(body)); }
        catch (e) { reject(new Error('bad JSON: ' + body.slice(0, 120))); }
      });
    });

    req.on('timeout', () => {
      // 'timeout' does not abort the request on its own; without destroy() the
      // socket lingers and the promise never settles.
      req.destroy(Object.assign(new Error('timeout after ' + timeoutMs + 'ms'),
                                { retry: true }));
    });
    req.on('error', (err) => {
      err.retry = true;
      reject(err);
    });
  });
}

/**
 * Retry with exponential backoff.
 *
 * Only for 429, timeouts and network faults — a malformed query fails
 * identically however often it is sent, and retrying spends more of a quota
 * already exhausted.
 */
async function fetchWithBackoff(url, label) {
  const delays = [0, 15000, 45000];
  let last = null;
  for (let i = 0; i < delays.length; i++) {
    if (delays[i]) await new Promise((r) => setTimeout(r, delays[i]));
    try {
      return await httpsGetJson(url, 100000);
    } catch (err) {
      last = err;
      console.warn(`refreshWorldData: ${label} attempt ${i + 1} failed:`,
                   err.message, err.code ? '(' + err.code + ')' : '');
      if (!err.retry) break;
    }
  }
  throw new Error(label + ': ' + (last ? last.message : 'unknown'));
}

async function refreshEvents(db) {
  const url = 'https://api.gdeltproject.org/api/v2/geo/geo' +
    '?query=' + encodeURIComponent(EVENTS_QUERY) +
    '&mode=pointdata&format=geojson&timespan=3h';

  const json = await fetchWithBackoff(url, 'events');
  const features = (json && json.features) || [];

  const events = features.map((f) => {
    const coords = (f.geometry && f.geometry.coordinates) || [];
    const p = f.properties || {};
    const lon = typeof coords[0] === 'number' ? coords[0] : null;
    const lat = typeof coords[1] === 'number' ? coords[1] : null;
    if (lon === null || lat === null) return null;

    const raw = String(p.html || p.name || '');
    const link = raw.match(/href=["']([^"']+)["']/i);
    const title = raw.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    if (!title) return null;

    return {
      lon, lat,
      place: String(p.name || '').trim().slice(0, 80),
      title: title.slice(0, 220),
      url: link ? link[1] : null,
      count: Number(p.count) || 1,
      cat: categorise(title + ' ' + (p.name || ''))
    };
  }).filter(Boolean);

  events.sort((a, b) => b.count - a.count);
  await db.doc('cache/worldEvents').set({
    events: events.slice(0, 400), fetchedAt: Date.now()
  });
  return events.length;
}

function fingerprint(title) {
  return String(title || '').toLowerCase()
    .replace(/[^a-z0-9 ]+/g, '').replace(/\s+/g, ' ').trim()
    .split(' ').slice(0, 9).join(' ');
}

function parseSeenDate(s) {
  const m = String(s || '').match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  if (!m) return null;
  const t = Date.parse(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`);
  return isNaN(t) ? null : t;
}

async function refreshNewswire(db) {
  const url = 'https://api.gdeltproject.org/api/v2/doc/doc' +
    '?query=' + encodeURIComponent(NEWS_QUERY) +
    '&mode=artlist&format=json&maxrecords=150&sort=datedesc&timespan=6h';

  const json = await fetchWithBackoff(url, 'newswire');
  const articles = (json && json.articles) || [];

  const seen = new Set();
  const items = [];
  for (const a of articles) {
    const title = String(a.title || '').trim();
    if (!title) continue;
    const fp = fingerprint(title);
    if (!fp || seen.has(fp)) continue;
    seen.add(fp);
    items.push({
      id: fp, title: title.slice(0, 200), url: a.url || null,
      source: String(a.domain || '').replace(/^www\./, '').slice(0, 40),
      at: parseSeenDate(a.seendate), cat: categorise(title)
    });
    if (items.length >= 60) break;
  }

  await db.doc('cache/newswire').set({ items, fetchedAt: Date.now() });
  return items.length;
}

exports.refreshWorldData = functions
  // Long timeout because THIS function is allowed to wait — nobody is blocked
  // on it. Three attempts with backoff, each up to 90s, needs the headroom.
  .runWith({ timeoutSeconds: 540, memory: '256MB' })
  .pubsub.schedule('every 20 minutes')
  .timeZone('UTC')
  .onRun(async () => {
    const db = admin.firestore();

    // Sequential, not parallel. Two simultaneous requests to a service already
    // returning 429 is the one thing guaranteed to make it worse.
    const results = {};
    try {
      results.events = await refreshEvents(db);
    } catch (err) {
      results.events = 'failed: ' + (err.message || err);
      await db.doc('cache/worldEvents').set(
        { lastError: String(err.message || err).slice(0, 300), lastErrorAt: Date.now() },
        { merge: true });
    }

    try {
      results.newswire = await refreshNewswire(db);
    } catch (err) {
      results.newswire = 'failed: ' + (err.message || err);
      await db.doc('cache/newswire').set(
        { lastError: String(err.message || err).slice(0, 300), lastErrorAt: Date.now() },
        { merge: true });
    }

    console.log('refreshWorldData:', JSON.stringify(results));
    return null;
  });
