/**
 * Stryker Trading Academy — world events feed
 *
 * Serves geocoded live news to the Terminal's world map, from GDELT: a free,
 * keyless, open global news database supported by Google Jigsaw, refreshed
 * every 15 minutes across 100+ languages.
 *
 * DEPLOY from the twitter-feed-function project:
 *   firebase deploy --only functions:getTwitterFeed,functions:mirrorTweets,
 *     functions:getWorldEvents
 *
 * WHY A PROXY RATHER THAN A BROWSER FETCH
 *   1. GDELT serves no permissive CORS headers, so a browser call is blocked
 *      however well-formed.
 *   2. One cached response serves every student. GDELT refreshes every 15
 *      minutes, so polling faster returns identical bytes.
 *   3. The raw response carries far more per article than a map pin needs.
 *
 * No key is involved, so nothing here is secret. The proxy is about politeness
 * to a free public service and payload size on mobile, not security.
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


const CACHE_DOC = 'cache/worldEvents';
const CACHE_MINUTES = 15;    // GDELT's own refresh cadence
const MAX_EVENTS = 400;      // the map thins these client-side by zoom

/**
 * GDELT REQUIRES AT LEAST ONE SEARCH TERM.
 *
 * The previous value was 'sourcelang:english' — a bare filter with no term to
 * filter. GDELT rejects that, which is why the map showed "Feed unavailable"
 * while the function itself ran fine: the request was well-formed HTTP and
 * malformed GDELT.
 *
 * Kept broad but valid: a modest OR of the subjects worth plotting. Long OR
 * chains are also a risk — GDELT limits query complexity — so this is nine
 * terms rather than the thirty a wishlist would produce.
 */
const QUERY = '(market OR economy OR "central bank" OR inflation OR ' +
              'conflict OR election OR sanctions OR protest OR tariff)';

// Category is derived server-side so every client agrees and the taxonomy can
// change without a site deploy. Order matters: first match wins, so the more
// specific patterns come first.
const CATEGORIES = [
  { key: 'centralbank', label: 'Central banks', colour: '#f5c542',
    re: /\b(fed|fomc|ecb|boe|boj|snb|rba|rbnz|pboc|central bank|interest rate|rate (cut|hike|decision)|monetary policy|powell|lagarde)\b/i },
  { key: 'econ', label: 'Economic data', colour: '#00adb5',
    re: /\b(inflation|cpi|ppi|gdp|unemployment|payrolls|nfp|jobless|retail sales|pmi|consumer confidence|trade balance)\b/i },
  { key: 'markets', label: 'Markets', colour: '#03c988',
    re: /\b(stocks?|shares?|equities|bond|yield|dollar|euro|currency|commodit|oil|gold|crude|nasdaq|s&p|dow|ftse|nikkei|crypto|bitcoin|earnings)\b/i },
  { key: 'conflict', label: 'Conflict', colour: '#e5484d',
    re: /\b(war|strikes?|attack|missile|invasion|troops|militar|conflict|ceasefire|sanction|protest|coup|unrest)\b/i },
  { key: 'politics', label: 'Politics', colour: '#8b7dd8',
    re: /\b(election|parliament|congress|senate|president|prime minister|government|policy|tariff|treaty|summit)\b/i }
];

function categorise(text) {
  for (const c of CATEGORIES) {
    if (c.re.test(text)) return c.key;
  }
  return 'other';
}

// Regexes cannot be serialised to JSON, and the client only needs label and
// colour anyway.
function stripRe(c) {
  return { key: c.key, label: c.label, colour: c.colour };
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

exports.getWorldEvents = functions
  .runWith({ timeoutSeconds: 60, memory: '256MB' })
  .https.onRequest(async (req, res) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Cache-Control', 'public, max-age=300');
    if (req.method === 'OPTIONS') { res.status(204).send(''); return; }

    const db = admin.firestore();
    const cats = CATEGORIES.map(stripRe);

    try {
      const cached = await db.doc(CACHE_DOC).get();
      if (cached.exists) {
        const d = cached.data();
        const age = (Date.now() - (d.fetchedAt || 0)) / 60000;
        if (age < CACHE_MINUTES && Array.isArray(d.events)) {
          res.json({ events: d.events, categories: cats, cached: true,
                     ageMinutes: Math.round(age) });
          return;
        }
      }
    } catch (err) {
      console.warn('getWorldEvents: cache read failed', err);
    }

    let events = [];
    try {
      const url = 'https://api.gdeltproject.org/api/v2/geo/geo' +
        '?query=' + encodeURIComponent(QUERY) +
        '&mode=pointdata&format=geojson&timespan=3h';

      const r = await fetch(url, {
        headers: { 'User-Agent': 'StrykerTradingAcademy/1.0 (terminal world map)' }
      });
      if (!r.ok) {
        // Body included in the log: GDELT explains rejections in plain text,
        // and the status alone cannot distinguish a bad query from an outage.
        const detail = await r.text().catch(() => '');
        console.error('getWorldEvents: GDELT', r.status, detail.slice(0, 300));
        throw new Error('GDELT ' + r.status + ': ' + detail.slice(0, 120));
      }

      const json = await r.json();
      const features = (json && json.features) || [];

      events = features.map((f) => {
        const g = f.geometry || {};
        const p = f.properties || {};
        const coords = g.coordinates || [];

        // GeoJSON is [lon, lat]. Named explicitly rather than passed as a bare
        // pair, because reversed coordinates plot every event in the ocean and
        // read as a projection bug rather than a data one.
        const lon = typeof coords[0] === 'number' ? coords[0] : null;
        const lat = typeof coords[1] === 'number' ? coords[1] : null;
        if (lon === null || lat === null) return null;

        // GDELT packs headline and source into an HTML blob. Strip tags for the
        // title but keep the first href as the source link.
        const raw = String(p.html || p.name || '');
        const linkMatch = raw.match(/href=["']([^"']+)["']/i);
        const title = raw.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
        if (!title) return null;

        return {
          lon, lat,
          place: String(p.name || '').trim().slice(0, 80),
          title: title.slice(0, 220),
          url: linkMatch ? linkMatch[1] : null,
          count: Number(p.count) || 1,
          cat: categorise(title + ' ' + (p.name || ''))
        };
      }).filter(Boolean);

      // Densest first: when the map thins points at low zoom, the ones kept
      // should be the most-reported, not whichever came back first.
      events.sort((a, b) => b.count - a.count);
      events = events.slice(0, MAX_EVENTS);
    } catch (err) {
      console.error('getWorldEvents:', describeFetchError(err));
      // Stale cache beats nothing: slightly old pins are far more useful than
      // an empty panel, and a brief GDELT outage should not degrade the
      // terminal.
      try {
        const stale = await db.doc(CACHE_DOC).get();
        if (stale.exists && Array.isArray(stale.data().events)) {
          res.json({ events: stale.data().events, categories: cats,
                     cached: true, stale: true });
          return;
        }
      } catch (e) { /* nothing cached either */ }
      // The message is passed through so the panel can say what actually went
      // wrong rather than "unavailable", which is indistinguishable from a
      // quiet news hour.
      res.status(200).json({ events: [], categories: cats,
                             error: describeFetchError(err) });
      return;
    }

    try {
      await db.doc(CACHE_DOC).set({ events, fetchedAt: Date.now() });
    } catch (err) {
      console.warn('getWorldEvents: cache write failed', err);
    }

    res.json({ events, categories: cats, cached: false });
  });
