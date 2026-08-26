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
 * The API key comes from Secret Manager, never from Firestore —
 * Firestore settings docs are world-readable by design so the site can render
 * branding, which would publish the key to anyone who opened the console.
 */

const functions = require('firebase-functions');
const admin = require('firebase-admin');
const { defineSecret } = require('firebase-functions/params');

// The same secret getTwitterFeed uses. Never hardcode the value — defineSecret
// pulls it from Secret Manager at runtime.
//
// This replaced the legacy runtime-config API, which was wrong twice over: it
// is deprecated and stops working in March 2027, and having two functions read
// the same credential from different stores means a rotation silently fixes one
// and leaves the other calling the API with a dead key.
const TWITTERAPI_KEY = defineSecret('TWITTERAPI_KEY');

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
function tweetToHtml(text) {
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

  // No "View on X" link. A mirrored post should read as content on the
  // Trading Floor, not as a teaser that sends students off the site — the
  // whole point of relaying a tweet is that they do not have to go and find
  // it. sourceUrl is still stored on the document for reference and
  // de-duplication; it simply is not rendered.
  return linked;
}


/**
 * Tweet creation time in ms, or null if it cannot be determined.
 *
 * twitterapi.io has returned several shapes across endpoints, so this tries the
 * ones actually seen rather than assuming one. Returning null on failure
 * matters: an unparseable timestamp must not be treated as "very old" and
 * silently dropped, nor as "brand new" and published. The caller decides.
 */
function tweetTimeMs(t) {
  const raw = t.createdAt || t.created_at || t.timestamp || t.date;
  if (!raw) return null;
  if (typeof raw === 'number') {
    // Seconds or milliseconds — anything below ~1e12 is seconds.
    return raw < 1e12 ? raw * 1000 : raw;
  }
  const parsed = Date.parse(raw);
  return isNaN(parsed) ? null : parsed;
}

exports.mirrorTweets = functions
  .runWith({ timeoutSeconds: 300, memory: '256MB', secrets: [TWITTERAPI_KEY] })
  .pubsub.schedule('every 30 minutes')
  .timeZone('UTC')
  .onRun(async () => {
    const db = admin.firestore();

    // Reads the bots COLLECTION, not a single settings doc. That is what makes
    // "add another bot" a row in the admin panel rather than a code change
    // here plus a new form there.
    const snap = await db.collection('bots')
      .where('type', '==', 'twitter-mirror')
      .where('enabled', '==', true)
      .get();

    if (snap.empty) {
      console.log('mirrorTweets: no enabled twitter-mirror bots');
      return null;
    }

    const apiKey = TWITTERAPI_KEY.value();
    if (!apiKey) {
      console.error('mirrorTweets: TWITTERAPI_KEY secret is empty');
      // Recorded on every bot, so the admin panel explains the silence rather
      // than showing bots that look healthy but never publish.
      await Promise.all(snap.docs.map((d) => d.ref.set({
        lastStatus: 'error',
        lastError: 'TWITTERAPI_KEY secret is not set on the server.',
        lastRunAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true })));
      return null;
    }

    // Bots run independently: one misconfigured handle must not stop the rest.
    await Promise.all(snap.docs.map((doc) => runBot(db, doc, apiKey)));
    return null;
  });

async function runBot(db, doc, apiKey) {
  const cfg = (doc.data().config) || {};
  const name = doc.data().name || doc.id;

  if (!cfg.screenName) {
    await doc.ref.set({
      lastStatus: 'error',
      lastError: 'No X account configured.',
      lastRunAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    return;
  }

  let tweets = [];
  try {
    const res = await fetch(
      `https://api.twitterapi.io/twitter/user/last_tweets?userName=${encodeURIComponent(cfg.screenName)}`,
      { headers: { 'X-API-Key': apiKey } });
    if (!res.ok) {
      // The status code is surfaced verbatim: 401 means the key, 404 means the
      // handle. Collapsing both into "failed" would make the panel useless for
      // telling those apart.
      await doc.ref.set({
        lastStatus: 'error',
        lastError: `X API returned ${res.status} for @${cfg.screenName}.`,
        lastRunAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
      return;
    }
    const json = await res.json();
    tweets = (json.data && json.data.tweets) || json.tweets || [];
  } catch (err) {
    await doc.ref.set({
      lastStatus: 'error',
      lastError: String(err.message || err).slice(0, 300),
      lastRunAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    return;
  }

  // Oldest first, so a batch lands on the floor in the order it was written.
  tweets = tweets.slice().reverse();

  const maxPerRun = Math.min(cfg.maxPerRun || 3, 10);
  // Default 60 minutes against a 30-minute schedule: wide enough that a late
  // or briefly failed run still catches everything, narrow enough that nothing
  // stale reaches the feed.
  const maxAgeMs = Math.max(5, cfg.maxAgeMinutes || 60) * 60 * 1000;
  let published = 0;
  let skippedOld = 0;

  for (const t of tweets) {
    if (published >= maxPerRun) break;

    const id = t.id || t.id_str;
    if (!id) continue;
    if (!cfg.includeReplies && (t.isReply || t.in_reply_to_status_id)) continue;
    if (!cfg.includeRetweets && (t.retweeted_tweet || t.is_retweet)) continue;
    if (await alreadyMirrored(db, id)) continue;

    // AGE GATE — publish only what is recent, never a backlog.
    //
    // Without this, a first run against a busy account works through that
    // account's entire recent history a few posts at a time, filling the
    // Trading Floor with hours-old news. The marker collection alone cannot
    // prevent it: a tweet with no marker is indistinguishable from a tweet
    // posted a second ago.
    //
    // Anything past the cutoff is MARKED AS SEEN rather than merely skipped,
    // so raising the cutoff later cannot suddenly release a flood of history.
    const ts = tweetTimeMs(t);
    if (ts !== null && (Date.now() - ts) > maxAgeMs) {
      await db.collection('mirroredTweets').doc(String(id)).set({
        tweetId: String(id),
        botId: doc.id,
        screenName: cfg.screenName,
        skippedTooOld: true,
        mirroredAt: admin.firestore.FieldValue.serverTimestamp()
      });
      skippedOld++;
      continue;
    }
    // A tweet whose timestamp could not be parsed is allowed through. Dropping
    // it would mean silently losing posts if the API ever changes its date
    // field; publishing one stale item is the cheaper mistake.

    const text = t.text || t.full_text || '';
    if (!text.trim()) continue;

    const url = t.url || `https://x.com/${cfg.screenName}/status/${id}`;

    // Marker FIRST. If the post write then fails, one tweet is never mirrored.
    // The reverse ordering would risk a crash between the two duplicating a
    // post on every subsequent run — far more visible to students.
    await db.collection('mirroredTweets').doc(String(id)).set({
      tweetId: String(id),
      botId: doc.id,
      screenName: cfg.screenName,
      mirroredAt: admin.firestore.FieldValue.serverTimestamp()
    });

    await db.collection('communityPosts').add({
      // The bot's OWN identity, not the shared team account. Three mirrors of
      // three different X accounts would otherwise be indistinguishable in the
      // feed, and a student could not tell an academy announcement from a
      // relayed tweet.
      //
      // Keyed on the bot's document id rather than its name, so renaming a bot
      // updates every post it has ever made instead of splitting its history
      // across two identities.
      authorUid: 'bot-' + doc.id,
      authorName: name,
      authorPlan: null,
      isTeamPost: false,
      isBotPost: true,
      botId: doc.id,
      sourceTweetId: String(id),
      sourceUrl: url,
      textHtml: tweetToHtml(text),
      imageDataUrl: null,
      category: cfg.category || 'propfirm',
      flair: null,
      likedBy: [], upvotedBy: [], downvotedBy: [], replyCount: 0,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    published++;
  }

  // Upsert the bot's profile so its name and avatar resolve in the feed even
  // if the admin panel has not written it — for instance a bot created before
  // per-bot identities existed.
  await db.collection('profiles').doc('bot-' + doc.id).set({
    uid: 'bot-' + doc.id,
    name: name,
    displayName: name,
    isBotAccount: true,
    customPhotoURL: cfg.avatarUrl || null,
    bio: cfg.screenName ? `Automated feed \u00b7 mirrors @${cfg.screenName}` : 'Automated feed'
  }, { merge: true });

  await doc.ref.set({
    lastStatus: 'ok',
    lastError: null,
    lastRunAt: admin.firestore.FieldValue.serverTimestamp(),
    publishedCount: admin.firestore.FieldValue.increment(published)
  }, { merge: true });

  console.log(`mirrorTweets[${name}]: published ${published} of ${tweets.length}` +
              `, skipped ${skippedOld} as too old`);
}
