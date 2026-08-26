/**
 * Stryker Trading Academy — world events feed
 *
 * Serves geocoded breaking-news events to the Terminal's world map, from
 * GDELT — a free, open, keyless global news database supported by Google
 * Jigsaw, updated every 15 minutes across 100+ languages.
 *
 * DEPLOY from the twitter-feed-function project:
 *   firebase deploy --only functions:getTwitterFeed,functions:mirrorTweets,
 *     functions:getWorldEvents
 *
 * WHY THIS EXISTS RATHER THAN CALLING GDELT FROM THE BROWSER
 *
 *   1. CORS. GDELT does not serve permissive CORS headers, so a browser fetch
 *      is blocked regardless of how well-formed it is.
 *   2. Caching. Every student loading the terminal would otherwise hit GDELT
 *      directly. One cached response serves all of them, and GDELT only
 *      refreshes every 15 minutes anyway — polling faster returns identical
 *      data.
 *   3. Shape. The raw response carries far more per article than a map pin
 *      needs. Trimming server-side keeps the payload small on mobile.
 *
 * No API key is involved, so nothing here is secret. The proxy is about
 * politeness to a free public service and payload size, not security.
 */

const functions = require('firebase-functions');
const admin = require('firebase-admin');

const CACHE_DOC = 'cache/worldEvents';
const CACHE_MINUTES = 15;   // matches GDELT's own refresh cadence
const MAX_EVENTS = 60;

// Themes that actually move markets, rather than all world news. GDELT's theme
// taxonomy is enormous; without a filter the map fills with human-interest
// stories that tell a trader nothing.
const QUERY = [
  '(theme:ECON_CENTRALBANK',
  'OR theme:ECON_INTEREST_RATE',
  'OR theme:ECON_INFLATION',
  'OR theme:ECON_STOCKMARKET',
  'OR theme:ECON_EARNINGSREPORT',
  'OR theme:WB_2689_ECONOMIC_GROWTH',
  'OR theme:ARMEDCONFLICT',
  'OR theme:CRISISLEX_CRISISLEXREC)'
].join(' ');

exports.getWorldEvents = functions
  .runWith({ timeoutSeconds: 60, memory: '256MB' })
  .https.onRequest(async (req, res) => {
    // The terminal is same-origin in production but this also has to work from
    // the GitHub Pages domain during testing.
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Cache-Control', 'public, max-age=300');
    if (req.method === 'OPTIONS') { res.status(204).send(''); return; }

    const db = admin.firestore();

    try {
      const cached = await db.doc(CACHE_DOC).get();
      if (cached.exists) {
        const d = cached.data();
        const age = (Date.now() - (d.fetchedAt || 0)) / 60000;
        if (age < CACHE_MINUTES && Array.isArray(d.events)) {
          res.json({ events: d.events, cached: true, ageMinutes: Math.round(age) });
          return;
        }
      }
    } catch (err) {
      // A cache miss is not a failure; fall through and fetch fresh.
      console.warn('getWorldEvents: cache read failed', err);
    }

    let events = [];
    try {
      const url = 'https://api.gdeltproject.org/api/v2/geo/geo' +
        '?query=' + encodeURIComponent(QUERY) +
        '&mode=pointdata&format=geojson&timespan=6h';

      const r = await fetch(url, {
        headers: { 'User-Agent': 'StrykerTradingAcademy/1.0 (terminal world map)' }
      });
      if (!r.ok) throw new Error('GDELT returned ' + r.status);

      const json = await r.json();
      const features = (json && json.features) || [];

      events = features.slice(0, MAX_EVENTS).map((f) => {
        const g = f.geometry || {};
        const p = f.properties || {};
        const coords = g.coordinates || [];
        return {
          // GeoJSON is [lon, lat]; the map expects them named, because a bare
          // pair in the wrong order plots events in the sea and looks like a
          // projection bug rather than a data one.
          lon: typeof coords[0] === 'number' ? coords[0] : null,
          lat: typeof coords[1] === 'number' ? coords[1] : null,
          title: String(p.name || p.html || '').slice(0, 180),
          country: String(p.name || '').split(',').pop().trim().slice(0, 40),
          url: p.url || null,
          count: p.count || 1
        };
      }).filter((e) => e.lat !== null && e.lon !== null && e.title);
    } catch (err) {
      console.error('getWorldEvents: fetch failed', err);
      // Serve stale cache rather than nothing. A map with slightly old pins is
      // far more useful than an empty panel, and GDELT being briefly down is
      // not a reason to degrade the terminal.
      try {
        const stale = await db.doc(CACHE_DOC).get();
        if (stale.exists && Array.isArray(stale.data().events)) {
          res.json({ events: stale.data().events, cached: true, stale: true });
          return;
        }
      } catch (e) { /* nothing cached either */ }
      res.status(200).json({ events: [], error: 'upstream unavailable' });
      return;
    }

    try {
      await db.doc(CACHE_DOC).set({ events, fetchedAt: Date.now() });
    } catch (err) {
      console.warn('getWorldEvents: cache write failed', err);
    }

    res.json({ events, cached: false });
  });
