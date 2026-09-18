/**
 * X (Twitter) API v2 client, OAuth 1.0a user context. Ported from
 * functions-src/xAutopost-x.js with chunked video upload added.
 *
 * Endpoints (api.x.com):
 *   POST /2/tweets                     create a post / reply (threads)
 *   POST /2/media/upload               image upload (simple) and video
 *                                      upload (INIT / APPEND / FINALIZE)
 *   GET  /2/media/upload?command=STATUS  video processing state
 *   GET  /2/users/me                   credential check
 *
 * Pay-per-use pricing (2026): a post costs more when it contains a link, so
 * the caller decides per settings.xLinkPolicy whether to append one.
 */
const crypto = require('crypto');
const { sleep } = require('../util');

const API = 'https://api.x.com';

function pct(s) {
  return encodeURIComponent(String(s)).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
}

function authHeader(creds, method, url, extraParams) {
  const oauth = {
    oauth_consumer_key: creds.apiKey, oauth_nonce: crypto.randomBytes(16).toString('hex'),
    oauth_signature_method: 'HMAC-SHA1', oauth_timestamp: String(Math.floor(Date.now() / 1000)),
    oauth_token: creds.accessToken, oauth_version: '1.0'
  };
  const all = Object.assign({}, extraParams || {}, oauth);
  const paramString = Object.keys(all).sort().map((k) => pct(k) + '=' + pct(all[k])).join('&');
  const base = [method.toUpperCase(), pct(url), pct(paramString)].join('&');
  const key = pct(creds.apiSecret) + '&' + pct(creds.accessSecret);
  oauth.oauth_signature = crypto.createHmac('sha1', key).update(base).digest('base64');
  return 'OAuth ' + Object.keys(oauth).sort().map((k) => pct(k) + '="' + pct(oauth[k]) + '"').join(', ');
}

class XApiError extends Error {
  constructor(status, body, where) {
    super(`X API ${status} on ${where}${summarise(body) ? ': ' + summarise(body) : ''}`);
    this.status = status; this.body = body;
  }
}
function summarise(body) {
  if (!body) return '';
  if (typeof body === 'string') return body.slice(0, 200);
  if (body.detail) return String(body.detail).slice(0, 200);
  if (body.title) return String(body.title).slice(0, 200);
  if (Array.isArray(body.errors) && body.errors[0]) return String(body.errors[0].message || body.errors[0].detail || '').slice(0, 200);
  return '';
}

async function call(creds, method, path, { query, json, form } = {}) {
  const url = API + path;
  const qs = query ? '?' + new URLSearchParams(query).toString() : '';
  const headers = { Authorization: authHeader(creds, method, url, query) };
  let body;
  if (json !== undefined) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(json); }
  else if (form) body = form;
  const res = await fetch(url + qs, { method, headers, body });
  const text = await res.text();
  let parsed = null;
  try { parsed = text ? JSON.parse(text) : null; } catch (e) { parsed = text; }
  if (!res.ok) throw new XApiError(res.status, parsed, method + ' ' + path);
  return parsed;
}

async function whoAmI(creds) {
  const r = await call(creds, 'GET', '/2/users/me');
  return r && r.data ? r.data : null;
}

async function setAlt(creds, id, altText) {
  if (!altText) return;
  try {
    await call(creds, 'POST', '/2/media/metadata', { json: { id: String(id), metadata: { alt_text: { text: String(altText).slice(0, 1000) } } } });
  } catch (e) { /* additive; never lose the upload over it */ }
}

/** Simple image upload. Returns the media id or null. */
async function uploadPng(creds, pngBuffer, altText) {
  const form = new FormData();
  form.append('media', new Blob([pngBuffer], { type: 'image/png' }), 'card.png');
  form.append('media_category', 'tweet_image');
  form.append('media_type', 'image/png');
  const r = await call(creds, 'POST', '/2/media/upload', { form });
  const id = r && r.data && (r.data.id || r.data.media_id_string || r.data.media_id);
  if (!id) return null;
  await setAlt(creds, id, altText);
  return String(id);
}

/** Chunked video upload (INIT, APPEND ×n, FINALIZE, then wait for processing). Returns the media id. */
async function uploadVideo(creds, mp4Buffer, altText) {
  const init = await call(creds, 'POST', '/2/media/upload/initialize', {
    json: { total_bytes: mp4Buffer.length, media_type: 'video/mp4', media_category: 'tweet_video' }
  });
  const id = init && init.data && (init.data.id || init.data.media_id_string);
  if (!id) throw new Error('X media INIT returned no id');
  const CHUNK = 4 * 1024 * 1024;
  for (let i = 0, seg = 0; i < mp4Buffer.length; i += CHUNK, seg++) {
    const form = new FormData();
    form.append('media', new Blob([mp4Buffer.subarray(i, Math.min(i + CHUNK, mp4Buffer.length))], { type: 'application/octet-stream' }), 'chunk');
    form.append('segment_index', String(seg));
    await call(creds, 'POST', `/2/media/upload/${id}/append`, { form });
  }
  let r = await call(creds, 'POST', `/2/media/upload/${id}/finalize`, { json: {} });
  let info = r && r.data && r.data.processing_info;
  for (let n = 0; info && info.state !== 'succeeded' && n < 40; n++) {
    if (info.state === 'failed') throw new Error('X video processing failed: ' + JSON.stringify(info.error || info));
    await sleep(Math.max(1, info.check_after_secs || 3) * 1000);
    r = await call(creds, 'GET', '/2/media/upload', { query: { command: 'STATUS', media_id: String(id) } });
    info = r && r.data && r.data.processing_info;
  }
  await setAlt(creds, id, altText);
  return String(id);
}

async function postTweet(creds, text, { mediaIds, replyTo } = {}) {
  const json = { text };
  if (mediaIds && mediaIds.length) json.media = { media_ids: mediaIds };
  if (replyTo) json.reply = { in_reply_to_tweet_id: String(replyTo) };
  const r = await call(creds, 'POST', '/2/tweets', { json });
  const id = r && r.data && r.data.id;
  if (!id) throw new Error('X API returned no tweet id');
  return String(id);
}

async function postThread(creds, parts, { mediaIds } = {}) {
  const ids = [];
  for (let i = 0; i < parts.length; i++) {
    ids.push(await postTweet(creds, parts[i], { mediaIds: i === 0 ? mediaIds : undefined, replyTo: ids.length ? ids[ids.length - 1] : undefined }));
  }
  return ids;
}

/** X's weighted length: URLs count 23, CJK/emoji count 2, cap 280. */
function weightedLength(text) {
  const withoutUrls = String(text || '').replace(/https?:\/\/[^\s]+/g, () => 'x'.repeat(23));
  let n = 0;
  for (const ch of withoutUrls) n += (ch.codePointAt(0) > 0x1100) ? 2 : 1;
  return n;
}

module.exports = { whoAmI, uploadPng, uploadVideo, postTweet, postThread, weightedLength, XApiError };
