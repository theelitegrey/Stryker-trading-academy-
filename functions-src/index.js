// Stryker Trading Academy — getTwitterFeed Cloud Function
//
// Purpose: securely proxies requests to twitterapi.io so the API key never
// reaches the browser. The static site (deployed via GitHub Pages) has no
// backend of its own, so this exists as a separate Firebase Cloud Function
// tied to the same Firebase project (strykertrades-e0cd8) that already
// powers the site's Firestore database.
//
// Endpoint (after deploy): https://REGION-PROJECT_ID.cloudfunctions.net/getTwitterFeed
// Called directly from the browser via fetch() — see assets/twitter-feed.js
// in the main site repo for the client side of this.
//
// Config: which accounts to follow lives in Firestore at
// settings/twitterFeed -> { usernames: ["account1", "account2", ...] }
// so the list can be changed without redeploying this function. Add it
// manually in the Firestore console for now — a small admin UI for this
// can be added later if it's worth building.
//
// Caching: twitterapi.io's own docs warn against calling their
// last_tweets endpoint frequently for the same account ("it will cost you
// a lot"), so results are cached in Firestore at settings/twitterFeedCache
// and only refreshed once the cache is older than CACHE_TTL_MS. Every
// page load within that window is served from cache at zero additional
// API cost.

const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const { logger } = require('firebase-functions');
const admin = require('firebase-admin');

admin.initializeApp();
const db = admin.firestore();

// Set this once via: firebase functions:secrets:set TWITTERAPI_KEY
// Never hardcode the actual key value here — defineSecret pulls it from
// Google Cloud Secret Manager at runtime, which is what keeps this key out
// of source control and out of the browser entirely.
const TWITTERAPI_KEY = defineSecret('TWITTERAPI_KEY');

const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes — adjust if a fresher or staler feed is worth the cost tradeoff
const MAX_TWEETS_PER_ACCOUNT = 5;
const MAX_TOTAL_TWEETS = 20;
const FUNCTION_VERSION = 'v6-nested'; // bump this string on any future change — makes it obvious from the response alone whether the latest code actually deployed, without guessing from response shape

exports.getTwitterFeed = onRequest(
  { secrets: [TWITTERAPI_KEY], cors: true, timeoutSeconds: 300, maxInstances: 10 },
  async (req, res) => {
    try {
      const cacheRef = db.collection('settings').doc('twitterFeedCache');
      const cacheSnap = await cacheRef.get();
      const cached = cacheSnap.exists ? cacheSnap.data() : null;
      const now = Date.now();

      // ?fresh=1 skips the cache entirely — added specifically so this can
      // be debugged just by visiting a URL in a browser, without needing
      // to wait out the cache or dig through any logs console.
      const forceFresh = req.query && req.query.fresh === '1';

      // Serve straight from cache if it's still fresh — this is the path
      // that keeps repeated page loads free of additional API cost.
      if (!forceFresh && cached && cached.fetchedAt && (now - cached.fetchedAt) < CACHE_TTL_MS) {
        res.set('Cache-Control', 'public, max-age=300');
        res.json({ tweets: cached.tweets || [], cached: true, functionVersion: FUNCTION_VERSION });
        return;
      }

      const configSnap = await db.collection('settings').doc('twitterFeed').get();
      const usernames = (configSnap.exists && configSnap.data().usernames) || [];

      if (!usernames.length) {
        res.json({ tweets: [], cached: false, functionVersion: FUNCTION_VERSION, message: 'No accounts configured yet — add settings/twitterFeed.usernames in Firestore.' });
        return;
      }

      const apiKey = TWITTERAPI_KEY.value();
      const allTweets = [];
      let anyFetchSucceeded = false;
      const debugInfo = []; // collected per-account outcome, included in the response below

      // Sequential with a delay between accounts — twitterapi.io's free
      // tier allows only 1 request every 5 seconds, and firing requests
      // back-to-back (as an earlier version of this did) hits that limit
      // almost immediately once there's more than one account configured.
      // This is a low-frequency background refresh (at most once per
      // CACHE_TTL_MS), so the extra few seconds this adds costs nothing
      // real in practice.
      let isFirst = true;
      for (const userName of usernames) {
        if (!isFirst) await new Promise((resolve) => setTimeout(resolve, 5200));
        isFirst = false;
        try {
          const response = await fetch(
            `https://api.twitterapi.io/twitter/user/last_tweets?userName=${encodeURIComponent(userName)}`,
            { headers: { 'X-API-Key': apiKey } }
          );
          if (!response.ok) {
            const bodyText = await response.text().catch(() => '');
            debugInfo.push({ userName, status: response.status, body: bodyText.slice(0, 300) });
            continue;
          }
          anyFetchSucceeded = true;
          const rawBodyText = await response.text();
          let data;
          try {
            data = JSON.parse(rawBodyText);
          } catch (parseErr) {
            debugInfo.push({ userName, status: response.status, parseError: true, rawBody: rawBodyText.slice(0, 500) });
            continue;
          }
          // twitterapi.io's published OpenAPI schema shows `tweets` at the
          // top level, but the live API for this endpoint actually nests it
          // under `data` — a known discrepancy between their docs and the
          // real response. Read either shape so this keeps working
          // whichever one is returned, rather than betting on the docs.
          const tweetsRaw = (data && data.tweets) || (data && data.data && data.data.tweets) || [];
          const tweets = tweetsRaw.slice(0, MAX_TWEETS_PER_ACCOUNT);
          debugInfo.push({
            userName,
            status: response.status,
            tweetsFound: tweets.length,
            // Only included when the tweets array came back empty — shows
            // the actual top-level shape of what twitterapi.io sent back,
            // so a genuinely-empty result can be told apart from this
            // code expecting the wrong field name.
            responseKeys: tweets.length ? undefined : Object.keys(data || {}),
            rawBodySample: tweets.length ? undefined : rawBodyText.slice(0, 500)
          });
          allTweets.push(...tweets);
        } catch (err) {
          debugInfo.push({ userName, error: String(err && err.message || err) });
        }
      }

      allTweets.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      const finalTweets = allTweets.slice(0, MAX_TOTAL_TWEETS);

      // Only cache if at least one account fetch genuinely succeeded.
      // Without this check, a transient failure (bad key, rate limit, a
      // typo'd username) gets "locked in" as an empty result for the full
      // TTL, masking the real error behind what looks like an
      // intentionally-empty feed. A real "every configured account
      // happened to have zero recent tweets" case is rare enough that
      // losing its cache benefit is the right tradeoff against silently
      // hiding failures for 15 minutes at a time.
      if (anyFetchSucceeded) {
        await cacheRef.set({ tweets: finalTweets, fetchedAt: now });
      }

      res.set('Cache-Control', 'public, max-age=300');
      // debug is only included when something's worth showing — either an
      // outright failure, or a suspiciously-empty result — so a normal
      // healthy response doesn't get cluttered with it.
      res.json({
        tweets: finalTweets,
        cached: false,
        functionVersion: FUNCTION_VERSION,
        debug: (!anyFetchSucceeded || !finalTweets.length) ? debugInfo : undefined
      });
    } catch (err) {
      logger.error('getTwitterFeed failed', err);
      res.status(500).json({ error: 'Failed to load feed', tweets: [], functionVersion: FUNCTION_VERSION, debug: String(err && err.message || err) });
    }
  }
);

exports.mirrorTweets = require('./mirrorTweets').mirrorTweets;
exports.getWorldEvents = require('./getWorldEvents').getWorldEvents;
exports.getNewswire = require('./getNewswire').getNewswire;
exports.getIntel = require('./getIntel').getIntel;
exports.refreshWorldData = require('./refreshWorldData').refreshWorldData;
exports.marketBots = require('./marketBots').marketBots;
Object.assign(exports, require('./brokerSync'));
Object.assign(exports, require('./razorpay'));
Object.assign(exports, require('./tvAccess'));
Object.assign(exports, require('./subscriptions'));
Object.assign(exports, require('./razorpaySubs'));
Object.assign(exports, require('./fxRate'));
Object.assign(exports, require('./replayBars'));
Object.assign(exports, require('./freeCheckout'));
Object.assign(exports, require('./referralPoints'));
Object.assign(exports, require('./xAutopost'));
Object.assign(exports, require('./accountAdmin'));
exports.onContactMessageCreated = require('./onContactMessageCreated').onContactMessageCreated;
exports.launchSaleOnOrder = require('./launchSale').launchSaleOnOrder;
