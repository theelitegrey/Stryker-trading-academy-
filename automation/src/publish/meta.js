/**
 * Meta: Instagram Reels / images via the Instagram Graph API, and Threads
 * via the Threads API. Both use the two-step "create container, then
 * publish" flow and both fetch media from a public URL, which is why this
 * server exposes DATA_DIR/media under PUBLIC_BASE_URL/media.
 *
 * Tokens: long-lived tokens (60 days). refreshTokens() is called by the
 * scheduler once a day and stores the fresh token in the kv table, which
 * takes precedence over .env from then on.
 */
const { env } = require('../config');
const db = require('../db');
const { sleep } = require('../util');
const log = require('../log');

const FB = 'https://graph.facebook.com/v21.0';
const TH = 'https://graph.threads.net/v1.0';

class MetaError extends Error {
  constructor(status, body, where) {
    const e = body && body.error ? body.error : {};
    super(`Meta ${status} on ${where}: ${e.message || JSON.stringify(body).slice(0, 200)}`);
    this.status = status; this.code = e.code; this.body = body;
  }
}

async function call(method, url, params) {
  const body = new URLSearchParams(params);
  const res = await fetch(method === 'GET' ? url + '?' + body.toString() : url, {
    method, headers: method === 'GET' ? {} : { 'content-type': 'application/x-www-form-urlencoded' }, body: method === 'GET' ? undefined : body
  });
  const text = await res.text();
  let parsed; try { parsed = JSON.parse(text); } catch (e) { parsed = text; }
  if (!res.ok) throw new MetaError(res.status, parsed, method + ' ' + url.replace(/\?.*/, ''));
  return parsed;
}

function tokens() {
  const saved = db.kvGet('metaTokens', {});
  return {
    ig: saved.igAccessToken || env.meta.igAccessToken,
    igAt: saved.igIssuedAt || 0,
    threads: saved.threadsAccessToken || env.meta.threadsAccessToken,
    threadsAt: saved.threadsIssuedAt || 0
  };
}

async function waitReady(getStatus, label) {
  for (let i = 0; i < 60; i++) {
    const s = await getStatus();
    if (s === 'FINISHED' || s === 'PUBLISHED') return;
    if (s === 'ERROR' || s === 'EXPIRED') throw new Error(label + ' container ' + s);
    await sleep(5000);
  }
  throw new Error(label + ' container not ready after 5 minutes');
}

// ---- Instagram -------------------------------------------------------------------

async function igWhoAmI() {
  const t = tokens();
  return call('GET', `${FB}/${env.meta.igUserId}`, { fields: 'id,username,media_count', access_token: t.ig });
}

/** Publishes a Reel (videoUrl) or an image (imageUrl). Returns {id, url}. */
async function igPublish({ caption, videoUrl, imageUrl, coverUrl }) {
  const t = tokens(); const uid = env.meta.igUserId;
  const params = { caption: caption || '', access_token: t.ig };
  if (videoUrl) { Object.assign(params, { media_type: 'REELS', video_url: videoUrl, share_to_feed: 'true' }); if (coverUrl) params.cover_url = coverUrl; }
  else if (imageUrl) Object.assign(params, { image_url: imageUrl });
  else throw new Error('Instagram needs a video or an image');
  const c = await call('POST', `${FB}/${uid}/media`, params);
  await waitReady(async () => (await call('GET', `${FB}/${c.id}`, { fields: 'status_code', access_token: t.ig })).status_code, 'Instagram');
  const pub = await call('POST', `${FB}/${uid}/media_publish`, { creation_id: c.id, access_token: t.ig });
  let url = null;
  try { url = (await call('GET', `${FB}/${pub.id}`, { fields: 'permalink', access_token: t.ig })).permalink; } catch (e) { /* optional */ }
  return { id: String(pub.id), url: url || `https://www.instagram.com/` };
}

// ---- Threads --------------------------------------------------------------------------

async function threadsWhoAmI() {
  const t = tokens();
  return call('GET', `${TH}/me`, { fields: 'id,username', access_token: t.threads });
}

/** Publishes text, an image or a video post. Returns {id, url}. */
async function threadsPublish({ text, videoUrl, imageUrl }) {
  const t = tokens(); const uid = env.meta.threadsUserId;
  const params = { text: text || '', access_token: t.threads };
  if (videoUrl) Object.assign(params, { media_type: 'VIDEO', video_url: videoUrl });
  else if (imageUrl) Object.assign(params, { media_type: 'IMAGE', image_url: imageUrl });
  else params.media_type = 'TEXT';
  const c = await call('POST', `${TH}/${uid}/threads`, params);
  if (videoUrl || imageUrl) {
    await waitReady(async () => (await call('GET', `${TH}/${c.id}`, { fields: 'status', access_token: t.threads })).status, 'Threads');
  }
  const pub = await call('POST', `${TH}/${uid}/threads_publish`, { creation_id: c.id, access_token: t.threads });
  let url = null;
  try { url = (await call('GET', `${TH}/${pub.id}`, { fields: 'permalink', access_token: t.threads })).permalink; } catch (e) { /* optional */ }
  return { id: String(pub.id), url: url || 'https://www.threads.net/' };
}

// ---- token refresh -------------------------------------------------------------------

/** Refreshes tokens older than 30 days. Safe to call daily. */
async function refreshTokens() {
  const t = tokens(); const month = 30 * 86400000; const now = Date.now();
  const saved = db.kvGet('metaTokens', {});
  if (t.threads && now - t.threadsAt > month) {
    try {
      const r = await call('GET', 'https://graph.threads.net/refresh_access_token', { grant_type: 'th_refresh_token', access_token: t.threads });
      if (r.access_token) { saved.threadsAccessToken = r.access_token; saved.threadsIssuedAt = now; log.info('meta: Threads token refreshed'); }
    } catch (e) { log.warn('meta: Threads token refresh failed:', e.message); }
  }
  if (t.ig && env.meta.appId && env.meta.appSecret && now - t.igAt > month) {
    try {
      const r = await call('GET', `${FB}/oauth/access_token`, { grant_type: 'fb_exchange_token', client_id: env.meta.appId, client_secret: env.meta.appSecret, fb_exchange_token: t.ig });
      if (r.access_token) { saved.igAccessToken = r.access_token; saved.igIssuedAt = now; log.info('meta: Instagram token refreshed'); }
    } catch (e) { log.warn('meta: Instagram token refresh failed:', e.message); }
  }
  db.kvSet('metaTokens', saved);
}

module.exports = { igWhoAmI, igPublish, threadsWhoAmI, threadsPublish, refreshTokens, MetaError };
