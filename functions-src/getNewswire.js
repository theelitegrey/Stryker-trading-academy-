/**
 * Stryker Trading Academy — newswire reader
 *
 * Reads ONLY the Firestore cache written by refreshWorldData; it never calls
 * GDELT. See getWorldEvents for the reasoning — in short, GDELT took 58.9
 * seconds to return HTTP 429, and nothing on a user's request path can wait on
 * a service that slow to refuse.
 *
 * DEPLOY:
 *   firebase deploy --only functions:getNewswire
 */

const functions = require('firebase-functions');
const admin = require('firebase-admin');

const CATEGORIES = [
  { key: 'centralbank', label: 'Central banks', colour: '#f5c542' },
  { key: 'econ',        label: 'Economic data', colour: '#00adb5' },
  { key: 'markets',     label: 'Markets',       colour: '#03c988' },
  { key: 'conflict',    label: 'Geopolitics',   colour: '#e5484d' }
];

exports.getNewswire = functions
  .runWith({ timeoutSeconds: 30, memory: '256MB' })
  .https.onRequest(async (req, res) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Cache-Control', 'public, max-age=120');
    if (req.method === 'OPTIONS') { res.status(204).send(''); return; }

    try {
      const doc = await admin.firestore().doc('cache/newswire').get();
      if (!doc.exists) {
        res.json({ items: [], categories: CATEGORIES,
                   error: 'No data yet — the background refresh has not run.' });
        return;
      }
      const d = doc.data();
      const ageMin = d.fetchedAt ? Math.round((Date.now() - d.fetchedAt) / 60000) : null;

      res.json({
        items: d.items || [],
        categories: CATEGORIES,
        ageMinutes: ageMin,
        // Older than an hour means the scheduled refresh is failing, not that
        // the news is quiet — a distinction the panel should be able to draw.
        stale: ageMin !== null && ageMin > 60,
        error: (!d.items || !d.items.length) ? (d.lastError || null) : null
      });
    } catch (err) {
      console.error('getNewswire:', err);
      res.json({ items: [], categories: CATEGORIES, error: 'Cache read failed.' });
    }
  });
