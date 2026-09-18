/**
 * Stryker Trading Academy — X (Twitter) API client for the autopost function
 *
 * Posts tweets, threads and images to the academy's own X account using the
 * official X API v2 with OAuth 1.0a user context. Nothing here reads X; the
 * read side of the site (mirrorTweets) goes through twitterapi.io with a
 * different key, and the two must not be confused:
 *
 *   TWITTERAPI_KEY                       reads other accounts   (mirrorTweets)
 *   X_API_KEY / X_API_SECRET             this app's consumer keys (developer.x.com)
 *   X_ACCESS_TOKEN / X_ACCESS_SECRET     the academy account's user tokens
 *
 * WHY OAUTH 1.0a AND NOT OAUTH 2.0: a 2.0 user token expires every two hours
 * and has to be refreshed with a rotating refresh token, which means a stored
 * secret that changes on every run. 1.0a user tokens do not expire. For a
 * server that posts to one account forever, that is the right trade.
 *
 * WHY NO LIBRARY: the whole of OAuth 1.0a signing is forty lines of HMAC-SHA1,
 * and every npm wrapper for it drags in its own HTTP stack. Node 22 has fetch,
 * FormData and Blob built in, which is everything the v2 endpoints need.
 *
 * Endpoints used (all api.x.com):
 *   POST /2/tweets               create a post, optionally as a reply (threads)
 *   POST /2/media/upload         simple image upload (v1.1 media/upload was
 *                                retired in 2025; do not switch back to it)
 *   GET  /2/users/me             credential check for the admin "Test" button
 */

const crypto = require('crypto');

const API = 'https://api.x.com';

// RFC 3986 percent-encoding. encodeURIComponent leaves !'()* alone; OAuth
// does not, and a tweet containing any of them would fail its signature.
function pct(s) {
  return encodeURIComponent(String(s))
    .replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
}

/**
 * Builds the Authorization header for one request.
 *
 * `extraParams` is the query string (and, for a form-encoded body, the body).
 * JSON and multipart bodies are NOT part of the signature base string, which
 * is why the two endpoints we use only ever sign their oauth_* parameters.
 */
function authHeader(creds, method, url, extraParams) {
  const oauth = {
    oauth_consumer_key: creds.apiKey,
    oauth_nonce: crypto.randomBytes(16).toString('hex'),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: String(Math.floor(Date.now() / 1000)),
    oauth_token: creds.accessToken,
    oauth_version: '1.0'
  };

  const all = Object.assign({}, extraParams || {}, oauth);
  const paramString = Object.keys(all).sort()
    .map((k) => pct(k) + '=' + pct(all[k])).join('&');
  const base = [method.toUpperCase(), pct(url), pct(paramString)].join('&');
  const key = pct(creds.apiSecret) + '&' + pct(creds.accessSecret);
  oauth.oauth_signature = crypto.createHmac('sha1', key).update(base).digest('base64');

  return 'OAuth ' + Object.keys(oauth).sort()
    .map((k) => pct(k) + '="' + pct(oauth[k]) + '"').join(', ');
}

class XApiError extends Error {
  constructor(status, body, where) {
    // The status code is preserved verbatim, as mirrorTweets does: 401 is the
    // keys, 403 is the app's permission level or a duplicate post, 429 is the
    // monthly cap. Folding them into "failed" would make the queue useless.
    const detail = summarise(body);
    super(`X API ${status} on ${where}${detail ? ': ' + detail : ''}`);
    this.status = status;
    this.body = body;
  }
}

function summarise(body) {
  if (!body) return '';
  if (typeof body === 'string') return body.slice(0, 200);
  if (body.detail) return String(body.detail).slice(0, 200);
  if (body.title) return String(body.title).slice(0, 200);
  if (Array.isArray(body.errors) && body.errors[0]) {
    return String(body.errors[0].message || body.errors[0].detail || '').slice(0, 200);
  }
  return '';
}

async function call(creds, method, path, { query, json, form } = {}) {
  const url = API + path;
  const qs = query ? '?' + new URLSearchParams(query).toString() : '';
  const headers = { Authorization: authHeader(creds, method, url, query) };
  let body;
  if (json !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(json);
  } else if (form) {
    body = form;   // fetch sets the multipart boundary itself
  }
  const res = await fetch(url + qs, { method, headers, body });
  const text = await res.text();
  let parsed = null;
  try { parsed = text ? JSON.parse(text) : null; } catch (e) { parsed = text; }
  if (!res.ok) throw new XApiError(res.status, parsed, method + ' ' + path);
  return parsed;
}

/** Credentials sanity check. Returns { id, username, name }. */
async function whoAmI(creds) {
  const r = await call(creds, 'GET', '/2/users/me');
  return r && r.data ? r.data : null;
}

/**
 * Uploads one PNG and returns its media id, or null if X refused it.
 *
 * Refusal is not fatal to the post: a text-only tweet is a lesser failure
 * than no tweet, so callers post without the card when this returns null.
 */
async function uploadPng(creds, pngBuffer, altText) {
  const form = new FormData();
  form.append('media', new Blob([pngBuffer], { type: 'image/png' }), 'card.png');
  form.append('media_category', 'tweet_image');
  form.append('media_type', 'image/png');
  const r = await call(creds, 'POST', '/2/media/upload', { form });
  const id = r && r.data && (r.data.id || r.data.media_id_string || r.data.media_id);
  if (!id) return null;

  if (altText) {
    // Alt text is a separate call and purely additive; a failure here must
    // not lose the upload we already paid for.
    try {
      await call(creds, 'POST', '/2/media/metadata', {
        json: { id: String(id), metadata: { alt_text: { text: String(altText).slice(0, 1000) } } }
      });
    } catch (e) {
      console.warn('xAutopost: alt text rejected:', e.message);
    }
  }
  return String(id);
}

/**
 * Posts one tweet. `replyTo` chains it under a previous tweet id (threads).
 * Returns the new tweet id.
 */
async function postTweet(creds, text, { mediaIds, replyTo } = {}) {
  const json = { text };
  if (mediaIds && mediaIds.length) json.media = { media_ids: mediaIds };
  if (replyTo) json.reply = { in_reply_to_tweet_id: String(replyTo) };
  const r = await call(creds, 'POST', '/2/tweets', { json });
  const id = r && r.data && r.data.id;
  if (!id) throw new Error('X API returned no tweet id');
  return String(id);
}

/**
 * Posts a thread: parts[0] is the head (with the card, if any); each later
 * part replies to the one before. Returns every tweet id in order.
 *
 * A thread that fails midway is left as posted — deleting the head would
 * also delete the replies for readers, and a partial thread on the timeline
 * is a lesser failure than a deleted one plus a repost. The caller records
 * which ids exist so the admin can see exactly what went out.
 */
async function postThread(creds, parts, { mediaIds } = {}) {
  const ids = [];
  for (let i = 0; i < parts.length; i++) {
    const id = await postTweet(creds, parts[i], {
      mediaIds: i === 0 ? mediaIds : undefined,
      replyTo: ids.length ? ids[ids.length - 1] : undefined
    });
    ids.push(id);
  }
  return ids;
}

/**
 * X counts a post's length in "weighted characters": most characters are 1,
 * CJK and emoji are 2, and every URL counts as 23 regardless of length. The
 * cap is 280. This is close enough to reject over-long drafts server-side
 * before they cost an API call.
 */
function weightedLength(text) {
  const withoutUrls = String(text || '').replace(/https?:\/\/[^\s]+/g, (m) => 'x'.repeat(23));
  let n = 0;
  for (const ch of withoutUrls) {
    const cp = ch.codePointAt(0);
    n += (cp > 0x1100) ? 2 : 1;
  }
  return n;
}

module.exports = { whoAmI, uploadPng, postTweet, postThread, weightedLength, XApiError };
