/**
 * Stryker Trading Academy — newswire
 *
 * A market headline feed built on GDELT's DOC 2.0 article search. Replaces the
 * FinancialJuice widget: same job, our branding, no third-party script running
 * on the page and no attribution constraints.
 *
 * DEPLOY from the twitter-feed-function project:
 *   firebase deploy --only functions:getTwitterFeed,functions:mirrorTweets,
 *     functions:getWorldEvents,functions:getNewswire
 *
 * DOC rather than GEO. The world map needs coordinates and uses the GEO
 * endpoint; a newswire needs recency and a headline, and GEO returns neither
 * reliably — its points are locations mentioned in coverage, not articles in
 * time order.
 */

const functions = require('firebase-functions');
const admin = require('firebase-admin');

const CACHE_DOC = 'cache/newswire';
const CACHE_MINUTES = 5;
const MAX_ITEMS = 60;

/**
 * Market-relevant coverage, phrased as an OR of concrete terms rather than
 * GDELT's theme codes.
 *
 * The world-map function learned this the hard way: theme tagging is sparse
 * enough that an AND of narrow themes over a few hours returns almost nothing.
 * Keyword OR over the last few hours returns a genuine stream.
 */
const QUERY = '(' + [
  '"central bank"', '"interest rate"', '"rate cut"', '"rate hike"',
  'inflation', 'CPI', 'GDP', '"jobs report"', 'payrolls', 'unemployment',
  '"federal reserve"', 'ECB', '"bank of england"', '"bank of japan"',
  'treasury', 'yields', 'dollar', 'euro', 'sterling',
  'oil', 'gold', 'crude', 'commodities',
  'stocks', 'equities', 'nasdaq', '"s&p 500"', 'earnings',
  'bitcoin', 'crypto', 'tariffs', 'sanctions'
].join(' OR ') + ') sourcelang:english';

const CATEGORIES = [
  { key: 'centralbank', label: 'Central banks', colour: '#f5c542',
    re: /\b(fed|fomc|ecb|boe|boj|snb|rba|rbnz|pboc|central bank|interest rate|rate (cut|hike|decision)|monetary policy|powell|lagarde)\b/i },
  { key: 'econ', label: 'Economic data', colour: '#00adb5',
    re: /\b(inflation|cpi|ppi|gdp|unemployment|payrolls|nfp|jobless|retail sales|pmi|consumer confidence|trade balance)\b/i },
  { key: 'markets', label: 'Markets', colour: '#03c988',
    re: /\b(stocks?|shares?|equities|bond|yield|dollar|euro|sterling|currency|commodit|oil|gold|crude|nasdaq|s&p|dow|ftse|nikkei|crypto|bitcoin|earnings)\b/i },
  { key: 'conflict', label: 'Geopolitics', colour: '#e5484d',
    re: /\b(war|strikes?|attack|missile|invasion|troops|militar|conflict|ceasefire|sanction|tariff|protest|coup|unrest)\b/i }
];

function categorise(text) {
  for (const c of CATEGORIES) if (c.re.test(text)) return c.key;
  return 'markets';   // the query is market-scoped, so this is a safer default
}

/**
 * GDELT stamps articles as YYYYMMDDTHHMMSSZ, which Date.parse does not accept —
 * it needs the dashes and colons. Returning null on a failure rather than
 * guessing keeps an unparseable date out of the "just now" bucket, where it
 * would sit permanently at the top of the feed.
 */
function parseSeenDate(s) {
  const m = String(s || '').match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  if (!m) return null;
  const t = Date.parse(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`);
  return isNaN(t) ? null : t;
}

/** Normalised headline, for de-duplication. */
function fingerprint(title) {
  return String(title || '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .slice(0, 9)          // first nine words: enough to identify a story,
    .join(' ');           // loose enough to catch outlet-specific suffixes
}

exports.getNewswire = functions
  .runWith({ timeoutSeconds: 60, memory: '256MB' })
  .https.onRequest(async (req, res) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Cache-Control', 'public, max-age=120');
    if (req.method === 'OPTIONS') { res.status(204).send(''); return; }

    const db = admin.firestore();
    const cats = CATEGORIES.map((c) => ({ key: c.key, label: c.label, colour: c.colour }));

    try {
      const cached = await db.doc(CACHE_DOC).get();
      if (cached.exists) {
        const d = cached.data();
        const age = (Date.now() - (d.fetchedAt || 0)) / 60000;
        if (age < CACHE_MINUTES && Array.isArray(d.items)) {
          res.json({ items: d.items, categories: cats, cached: true });
          return;
        }
      }
    } catch (err) {
      console.warn('getNewswire: cache read failed', err);
    }

    let items = [];
    try {
      const url = 'https://api.gdeltproject.org/api/v2/doc/doc' +
        '?query=' + encodeURIComponent(QUERY) +
        '&mode=artlist&format=json&maxrecords=150&sort=datedesc&timespan=6h';

      const r = await fetch(url, {
        headers: { 'User-Agent': 'StrykerTradingAcademy/1.0 (newswire)' }
      });
      if (!r.ok) throw new Error('GDELT returned ' + r.status);

      const json = await r.json();
      const articles = (json && json.articles) || [];

      // De-duplicate. A single story is carried by dozens of outlets and GDELT
      // returns each separately; without this the feed is the same headline
      // twenty times and looks broken rather than busy.
      const seen = new Set();
      for (const a of articles) {
        const title = String(a.title || '').trim();
        if (!title) continue;
        const fp = fingerprint(title);
        if (!fp || seen.has(fp)) continue;
        seen.add(fp);

        items.push({
          // The fingerprint doubles as a stable id, so the client can tell a
          // genuinely new headline from one that has simply moved position.
          id: fp,
          title: title.slice(0, 200),
          url: a.url || null,
          source: String(a.domain || '').replace(/^www\./, '').slice(0, 40),
          country: String(a.sourcecountry || '').slice(0, 30),
          at: parseSeenDate(a.seendate),
          cat: categorise(title)
        });
        if (items.length >= MAX_ITEMS) break;
      }
    } catch (err) {
      console.error('getNewswire: fetch failed', err);
      try {
        const stale = await db.doc(CACHE_DOC).get();
        if (stale.exists && Array.isArray(stale.data().items)) {
          res.json({ items: stale.data().items, categories: cats,
                     cached: true, stale: true });
          return;
        }
      } catch (e) { /* nothing cached */ }
      res.status(200).json({ items: [], categories: cats,
                             error: 'upstream unavailable' });
      return;
    }

    try {
      await db.doc(CACHE_DOC).set({ items, fetchedAt: Date.now() });
    } catch (err) {
      console.warn('getNewswire: cache write failed', err);
    }

    res.json({ items, categories: cats, cached: false });
  });
