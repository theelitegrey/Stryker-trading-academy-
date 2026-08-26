/**
 * Stryker Trading Academy — world events reader
 *
 * Reads ONLY the Firestore cache written by refreshWorldData. It never calls
 * GDELT.
 *
 * DEPLOY:
 *   firebase deploy --only functions:getWorldEvents
 *
 * WHY IT NO LONGER FETCHES
 * Measured, GDELT answered one request with HTTP 429 after 58.9 seconds. It
 * does not refuse quickly; it queues and then refuses. Anything on a user's
 * request path that waits on that is broken by construction — no timeout value
 * makes a minute-long rejection acceptable in a page load.
 *
 * So the fetch moved to refreshWorldData, on a schedule, where waiting a minute
 * and retrying costs nobody anything. This function is now a Firestore read:
 * fast, predictable, and incapable of the failure that produced "fetch failed".
 */

const functions = require('firebase-functions');
const admin = require('firebase-admin');

const CATEGORIES = [
  { key: 'centralbank', label: 'Central banks', colour: '#f5c542' },
  { key: 'econ',        label: 'Economic data', colour: '#00adb5' },
  { key: 'markets',     label: 'Markets',       colour: '#03c988' },
  { key: 'conflict',    label: 'Geopolitics',   colour: '#e5484d' },
  { key: 'politics',    label: 'Politics',      colour: '#8b7dd8' }
];

exports.getWorldEvents = functions
  .runWith({ timeoutSeconds: 30, memory: '256MB' })
  .https.onRequest(async (req, res) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Cache-Control', 'public, max-age=180');
    if (req.method === 'OPTIONS') { res.status(204).send(''); return; }

    try {
      const doc = await admin.firestore().doc('cache/worldEvents').get();
      if (!doc.exists) {
        res.json({ events: [], categories: CATEGORIES,
                   error: 'No data yet — the background refresh has not run.' });
        return;
      }
      const d = doc.data();
      const ageMin = d.fetchedAt ? Math.round((Date.now() - d.fetchedAt) / 60000) : null;

      res.json({
        events: d.events || [],
        categories: CATEGORIES,
        ageMinutes: ageMin,
        // A refresh failure is reported alongside whatever data survives, so a
        // stale-but-populated map can still say why it stopped updating.
        error: (!d.events || !d.events.length) ? (d.lastError || null) : null,
        refreshError: d.lastError || null
      });
    } catch (err) {
      console.error('getWorldEvents:', err);
      res.json({ events: [], categories: CATEGORIES, error: 'Cache read failed.' });
    }
  });
