/**
 * Stryker Trading Academy — tweet mirror bot
 *
 * Scheduled Cloud Function. Polls a configured X/Twitter account and publishes
 * new posts to the Trading Floor under the Stryker Team identity.
 *
 * DEPLOY (must name every function, or the others get deleted):
 *   firebase deploy --only functions:deleteUserAccount,functions:onNotificationCreated,
 *     functions:onContactMessageCreated,functions:mirrorTweets
 *
 * CONFIG lives in Firestore at settings/twitterBot:
 *   { enabled: true,
 *     screenName: 'someaccount',      // without the @
 *     maxPerRun: 3,
 *     includeReplies: false,
 *     includeRetweets: false }
 *
 * The API key stays in functions config (twitterapi.key), never in Firestore —
 * Firestore settings docs are world-readable by design so the site can render
 * branding, which would publish the key to anyone who opened the console.
 */

const functions = require('firebase-functions');
const admin = require('firebase-admin');

const TEAM_UID = 'stryker-team';
const TEAM_NAME = 'Stryker Team';

/**
 * Why a per-tweet document rather than "posts newer than the last timestamp":
 * a timestamp cursor double-posts whenever two tweets share a second, and
 * loses everything if a single run fails midway. An explicit
 * mirroredTweets/{tweetId} marker makes the operation idempotent — the same
 * tweet can be seen any number of times and will only ever produce one post.
 */
async function alreadyMirrored(db, tweetId) {
  const doc = await db.collection('mirroredTweets').doc(String(tweetId)).get();
  return doc.exists;
}

/** Tweet text to the floor's stored HTML, safely. */
function tweetToHtml(text, tweetUrl) {
  const escaped = String(text || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  // Linkify only what we recognise. Passing tweet text through untouched would
  // let anyone the bot follows inject markup into every student's feed — the
  // bot posts with elevated identity, so its input is untrusted by definition.
  const linked = escaped
    .replace(/https?:\/\/[^\s<]+/g,
      (u) => `<a href="${u}" target="_blank" rel="noopener noreferrer">${u}</a>`)
    .replace(/(^|\s)#(\w+)/g, '$1<span class="floor-tag">#$2</span>')
    .replace(/(^|\s)@(\w+)/g,
      (m, pre, handle) => `${pre}<a href="https://x.com/${handle}" target="_blank" rel="noopener noreferrer">@${handle}</a>`)
    .replace(/\n/g, '<br>');

  return linked +
    `<br><br><a href="${tweetUrl}" target="_blank" rel="noopener noreferrer" class="floor-source-link">View on X →</a>`;
}

exports.mirrorTweets = functions
  .runWith({ timeoutSeconds: 120, memory: '256MB' })
  .pubsub.schedule('every 30 minutes')
  .timeZone('UTC')
  .onRun(async () => {
    const db = admin.firestore();

    const cfgDoc = await db.collection('settings').doc('twitterBot').get();
    if (!cfgDoc.exists) {
      console.log('mirrorTweets: no settings/twitterBot document — nothing to do');
      return null;
    }
    const cfg = cfgDoc.data();
    if (!cfg.enabled || !cfg.screenName) {
      console.log('mirrorTweets: disabled or no screenName configured');
      return null;
    }

    const apiKey = (functions.config().twitterapi || {}).key;
    if (!apiKey) {
      console.error('mirrorTweets: twitterapi.key is not set in functions config');
      return null;
    }

    let tweets = [];
    try {
      const res = await fetch(
        `https://api.twitterapi.io/twitter/user/last_tweets?userName=${encodeURIComponent(cfg.screenName)}`,
        { headers: { 'X-API-Key': apiKey } });
      if (!res.ok) {
        console.error('mirrorTweets: upstream returned', res.status);
        return null;
      }
      const json = await res.json();
      tweets = (json.data && json.data.tweets) || json.tweets || [];
    } catch (err) {
      // A failed poll is not an incident — the next run picks up anything
      // missed, because the marker collection makes catch-up free.
      console.error('mirrorTweets: fetch failed', err);
      return null;
    }

    // Oldest first, so a batch arrives on the floor in the order it was
    // written rather than reversed.
    tweets = tweets.slice().reverse();

    const maxPerRun = Math.min(cfg.maxPerRun || 3, 10);
    let published = 0;

    for (const t of tweets) {
      if (published >= maxPerRun) break;

      const id = t.id || t.id_str;
      if (!id) continue;
      if (!cfg.includeReplies && (t.isReply || t.in_reply_to_status_id)) continue;
      if (!cfg.includeRetweets && (t.retweeted_tweet || t.is_retweet)) continue;
      if (await alreadyMirrored(db, id)) continue;

      const text = t.text || t.full_text || '';
      if (!text.trim()) continue;

      const url = t.url || `https://x.com/${cfg.screenName}/status/${id}`;

      // Marker written FIRST. If the post write then fails, the worst outcome
      // is one tweet never mirrored. Writing it after would risk the reverse —
      // a crash between the two producing a duplicate post on every subsequent
      // run, which is far more visible to students.
      await db.collection('mirroredTweets').doc(String(id)).set({
        tweetId: String(id),
        screenName: cfg.screenName,
        mirroredAt: admin.firestore.FieldValue.serverTimestamp()
      });

      await db.collection('communityPosts').add({
        authorUid: TEAM_UID,
        authorName: TEAM_NAME,
        authorPlan: null,
        isTeamPost: true,
        isBotPost: true,                 // so it can be filtered or styled apart
        sourceTweetId: String(id),
        sourceUrl: url,
        textHtml: tweetToHtml(text, url),
        imageDataUrl: null,
        category: cfg.category || 'propfirm',
        flair: null,
        likedBy: [], upvotedBy: [], downvotedBy: [], replyCount: 0,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });

      published++;
    }

    console.log(`mirrorTweets: published ${published} of ${tweets.length} fetched`);
    return null;
  });
