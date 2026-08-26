/**
 * Stryker Trading Academy — WorldMonitor proxy
 *
 * Fronts the WorldMonitor REST API for the Terminal's Intel tab.
 *   https://api.worldmonitor.app/api/<service>/v1/<rpc-name>
 *
 * DEPLOY from the twitter-feed-function project:
 *   firebase deploy --only functions:getTwitterFeed,functions:mirrorTweets,
 *     functions:getWorldEvents,functions:getNewswire,functions:getWorldMonitor
 *
 * SETUP: the key must be in Secret Manager before this works.
 *   firebase functions:secrets:set WORLDMONITOR_KEY
 * Get a key at https://www.worldmonitor.app/pro
 *
 * WHY A SERVER PROXY IS NOT OPTIONAL HERE
 * The key is a paid credential. In client-side JavaScript it is public — anyone
 * opening devtools can lift it and spend the quota. Their docs also note that
 * api.worldmonitor.app is the programmatic host precisely because the main
 * domain rejects non-browser origins, so this has to be a server call anyway.
 *
 * THE PATH ALLOWLIST IS THE SECURITY BOUNDARY
 * Without it this is an open proxy: anyone could pass ?path=/api/anything and
 * use our paid key for their own purposes. Only the paths the terminal actually
 * renders are permitted.
 */

const functions = require('firebase-functions');
const admin = require('firebase-admin');
const { defineSecret } = require('firebase-functions/params');

const WORLDMONITOR_KEY = defineSecret('WORLDMONITOR_KEY');

const API_BASE = 'https://api.worldmonitor.app';
const CACHE_PREFIX = 'cache/wm_';

/**
 * Allowed endpoints, each with its own cache lifetime.
 *
 * Lifetimes differ by how fast the underlying number actually moves. Caching a
 * sentiment index that updates daily for the same 90 seconds as a live quote
 * wastes quota on every single view; caching quotes for a day makes the panel
 * lie. Both mistakes look identical from the outside, which is why the number
 * lives next to the path rather than being a single global constant.
 */
const ENDPOINTS = {
  'fear-greed':      { path: '/api/market/v1/get-fear-greed-index',        ttl: 15 },
  'market-composite':{ path: '/api/market/v1/get-market-composite',        ttl: 5 },
  'indices':         { path: '/api/market/v1/list-indices',                ttl: 5 },
  'commodities':     { path: '/api/market/v1/list-commodities',            ttl: 5 },
  'fx':              { path: '/api/market/v1/list-fx-rates',               ttl: 5 },
  'macro':           { path: '/api/economic/v1/get-country-macro',         ttl: 180 },
  'consumer-prices': { path: '/api/consumer-prices/v1/get-latest',         ttl: 720 },
  'predictions':     { path: '/api/predictions/v1/list-markets',           ttl: 30 },
  'shipping':        { path: '/api/supply-chain/v1/get-shipping-stress',   ttl: 120 },
  'minerals':        { path: '/api/supply-chain/v1/get-critical-minerals', ttl: 720 },
  'sanctions':       { path: '/api/sanctions/v1/list-recent',              ttl: 120 },
  'resilience':      { path: '/api/resilience/v1/get-resilience-ranking',  ttl: 720 },
  'news-digest':     { path: '/api/news/v1/get-feed-digest',               ttl: 10 }
};

exports.getWorldMonitor = functions
  .runWith({ timeoutSeconds: 60, memory: '256MB', secrets: [WORLDMONITOR_KEY] })
  .https.onRequest(async (req, res) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Cache-Control', 'public, max-age=60');
    if (req.method === 'OPTIONS') { res.status(204).send(''); return; }

    const key = WORLDMONITOR_KEY.value();
    if (!key) {
      // 200 with a flag rather than 500: the terminal shows a "not configured"
      // panel, and an error status would be indistinguishable from an outage.
      res.json({ ok: false, reason: 'no-key',
                 message: 'WORLDMONITOR_KEY is not set on the server.' });
      return;
    }

    // Comma-separated ids, so one round trip fills the whole tab.
    const ids = String(req.query.ids || '').split(',')
      .map((s) => s.trim()).filter(Boolean)
      .filter((id) => ENDPOINTS[id]);

    if (!ids.length) {
      res.status(400).json({ ok: false, reason: 'bad-request',
                             allowed: Object.keys(ENDPOINTS) });
      return;
    }

    const db = admin.firestore();
    const out = {};
    const misses = [];

    // Serve whatever is still fresh before calling upstream at all.
    await Promise.all(ids.map(async (id) => {
      try {
        const doc = await db.doc(CACHE_PREFIX + id).get();
        if (doc.exists) {
          const d = doc.data();
          const age = (Date.now() - (d.fetchedAt || 0)) / 60000;
          if (age < ENDPOINTS[id].ttl) { out[id] = d.body; return; }
          // Held aside: if upstream fails, stale data beats an empty panel.
          d._stale = true;
          out[id] = null;
          misses.push({ id, stale: d.body });
          return;
        }
      } catch (err) {
        console.warn('getWorldMonitor: cache read failed for', id, err);
      }
      misses.push({ id, stale: null });
    }));

    if (!misses.length) {
      res.json({ ok: true, data: out, cached: true });
      return;
    }

    // Their batch endpoint runs up to 20 GETs concurrently in one request.
    // Worth using even for two or three: it is one TLS handshake and one
    // round trip instead of N, which on a Cloud Function is most of the
    // latency. Note it saves round trips, not quota — each operation still
    // counts individually.
    try {
      const r = await fetch(API_BASE + '/api/batch/v1/execute', {
        method: 'POST',
        headers: {
          'X-WorldMonitor-Key': key,
          'Content-Type': 'application/json',
          'User-Agent': 'StrykerTradingAcademy/1.0'
        },
        body: JSON.stringify({
          operations: misses.map((m) => ({ id: m.id, path: ENDPOINTS[m.id].path }))
        })
      });

      if (!r.ok) {
        const text = await r.text().catch(() => '');
        console.error('getWorldMonitor: batch returned', r.status, text.slice(0, 300));
        // The status code is surfaced verbatim. 401 means the key, 402/429 mean
        // the plan, 404 means the path — collapsing them into "failed" makes
        // the panel useless for telling those apart.
        fallbackToStale(out, misses);
        res.json({ ok: false, reason: 'upstream', status: r.status, data: out });
        return;
      }

      const json = await r.json();
      // Their envelope shape is not something I could verify from here, so the
      // response is probed for the plausible shapes rather than assumed. An
      // unrecognised shape falls back to stale rather than rendering nothing.
      const results = json.results || json.operations || json.data || json;

      misses.forEach((m) => {
        let body = null;
        if (Array.isArray(results)) {
          const hit = results.find((x) => x && (x.id === m.id));
          body = hit ? (hit.body || hit.data || hit.result || hit) : null;
        } else if (results && typeof results === 'object') {
          const hit = results[m.id];
          body = hit ? (hit.body || hit.data || hit.result || hit) : null;
        }
        if (body) {
          out[m.id] = body;
          db.doc(CACHE_PREFIX + m.id)
            .set({ body, fetchedAt: Date.now() })
            .catch((e) => console.warn('cache write failed', m.id, e));
        } else if (m.stale) {
          out[m.id] = m.stale;
        }
      });

      res.json({ ok: true, data: out, cached: false });
    } catch (err) {
      console.error('getWorldMonitor: batch failed', err);
      fallbackToStale(out, misses);
      res.json({ ok: false, reason: 'network', data: out });
    }
  });

function fallbackToStale(out, misses) {
  misses.forEach((m) => { if (m.stale) out[m.id] = m.stale; });
}
