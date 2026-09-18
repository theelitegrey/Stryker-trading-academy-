/**
 * "Connect" flows for the admin page. Each starts at /oauth/<platform>/start
 * (admin-authenticated), sends the browser to the platform's consent page,
 * and returns to /oauth/<platform>/callback, which stores the tokens with
 * secrets.save() and sends the browser back to the admin page.
 *
 * The app credentials (X consumer key, Meta app id, Google client id) are
 * still created by the operator on each platform's developer site; that is
 * the part no software can do for them. GETTING-STARTED.md walks through it.
 */
const crypto = require('crypto');
const { env } = require('../config');
const secrets = require('../secrets');
const db = require('../db');

const FB = 'https://graph.facebook.com/v21.0';

function callbackUrl(platform) { return env.publicBaseUrl + '/oauth/' + platform + '/callback'; }

function stateFor(platform) {
  const s = crypto.randomBytes(16).toString('hex');
  db.kvSet('oauthState', Object.assign(db.kvGet('oauthState', {}), { [platform]: { s, at: Date.now() } }));
  return s;
}
function checkState(platform, s) {
  const st = (db.kvGet('oauthState', {}) || {})[platform];
  return !!(st && st.s === s && Date.now() - st.at < 15 * 60000);
}

async function postForm(url, params) {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params) });
  const text = await res.text();
  let j; try { j = JSON.parse(text); } catch (e) { j = { raw: text }; }
  if (!res.ok) throw new Error((j.error && (j.error.message || j.error_description || j.error)) || j.error_description || text.slice(0, 200));
  return j;
}
async function getJson(url, params) {
  const res = await fetch(url + '?' + new URLSearchParams(params));
  const j = await res.json();
  if (!res.ok) throw new Error((j.error && (j.error.message || j.error)) || res.status);
  return j;
}

// ---- YouTube ------------------------------------------------------------------------

function youtubeStart() {
  if (!env.youtube.clientId || !env.youtube.clientSecret) throw new Error('Save the Google client ID and secret first.');
  return 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
    client_id: env.youtube.clientId, redirect_uri: callbackUrl('youtube'), response_type: 'code', access_type: 'offline', prompt: 'consent',
    scope: 'https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly', state: stateFor('youtube')
  });
}
async function youtubeCallback(q) {
  if (!checkState('youtube', q.state)) throw new Error('Sign-in expired, try again.');
  if (q.error) throw new Error(q.error);
  const j = await postForm('https://oauth2.googleapis.com/token', { code: q.code, client_id: env.youtube.clientId, client_secret: env.youtube.clientSecret, redirect_uri: callbackUrl('youtube'), grant_type: 'authorization_code' });
  if (!j.refresh_token) throw new Error('Google did not return a refresh token. Remove the app at myaccount.google.com/permissions and connect again.');
  secrets.save({ youtube: { refreshToken: j.refresh_token } });
  return 'YouTube connected';
}

// ---- Instagram via Facebook Login -----------------------------------------------------------

function instagramStart() {
  if (!env.meta.appId || !env.meta.appSecret) throw new Error('Save the Meta app ID and secret first.');
  return 'https://www.facebook.com/v21.0/dialog/oauth?' + new URLSearchParams({
    client_id: env.meta.appId, redirect_uri: callbackUrl('instagram'), response_type: 'code', state: stateFor('instagram'),
    scope: 'instagram_basic,instagram_content_publish,pages_show_list,pages_read_engagement,business_management'
  });
}
async function instagramCallback(q) {
  if (!checkState('instagram', q.state)) throw new Error('Sign-in expired, try again.');
  if (q.error) throw new Error(q.error_description || q.error);
  const short = await getJson(`${FB}/oauth/access_token`, { client_id: env.meta.appId, client_secret: env.meta.appSecret, redirect_uri: callbackUrl('instagram'), code: q.code });
  const long = await getJson(`${FB}/oauth/access_token`, { grant_type: 'fb_exchange_token', client_id: env.meta.appId, client_secret: env.meta.appSecret, fb_exchange_token: short.access_token });
  const pages = await getJson(`${FB}/me/accounts`, { fields: 'id,name,instagram_business_account', access_token: long.access_token });
  const page = (pages.data || []).find((p) => p.instagram_business_account);
  if (!page) throw new Error('No Instagram Business account is linked to any of your Facebook Pages. Link it in the Instagram app (Settings → Account type and tools → Linked accounts) and try again.');
  secrets.save({ meta: { igUserId: page.instagram_business_account.id, igAccessToken: long.access_token } });
  db.kvSet('metaTokens', Object.assign(db.kvGet('metaTokens', {}), { igAccessToken: long.access_token, igIssuedAt: Date.now() }));
  return 'Instagram connected via Page "' + page.name + '"';
}

// ---- Threads ------------------------------------------------------------------------------

function threadsStart() {
  if (!env.meta.threadsAppId || !env.meta.threadsAppSecret) throw new Error('Save the Threads app ID and secret first.');
  return 'https://threads.net/oauth/authorize?' + new URLSearchParams({
    client_id: env.meta.threadsAppId, redirect_uri: callbackUrl('threads'), response_type: 'code', state: stateFor('threads'),
    scope: 'threads_basic,threads_content_publish'
  });
}
async function threadsCallback(q) {
  if (!checkState('threads', q.state)) throw new Error('Sign-in expired, try again.');
  if (q.error) throw new Error(q.error_description || q.error);
  const code = String(q.code || '').replace(/#_$/, '');
  const short = await postForm('https://graph.threads.net/oauth/access_token', { client_id: env.meta.threadsAppId, client_secret: env.meta.threadsAppSecret, grant_type: 'authorization_code', redirect_uri: callbackUrl('threads'), code });
  const long = await getJson('https://graph.threads.net/access_token', { grant_type: 'th_exchange_token', client_secret: env.meta.threadsAppSecret, access_token: short.access_token });
  secrets.save({ meta: { threadsUserId: String(short.user_id), threadsAccessToken: long.access_token } });
  db.kvSet('metaTokens', Object.assign(db.kvGet('metaTokens', {}), { threadsAccessToken: long.access_token, threadsIssuedAt: Date.now() }));
  return 'Threads connected';
}

// ---- X (OAuth 1.0a, three-legged) ----------------------------------------------------------------

function pct(s) { return encodeURIComponent(String(s)).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase()); }
function sign(method, url, params, consumerSecret, tokenSecret) {
  const base = [method, pct(url), pct(Object.keys(params).sort().map((k) => pct(k) + '=' + pct(params[k])).join('&'))].join('&');
  return crypto.createHmac('sha1', pct(consumerSecret) + '&' + pct(tokenSecret || '')).update(base).digest('base64');
}
async function oauth1(url, extra, tokenSecret) {
  const o = Object.assign({ oauth_consumer_key: env.x.apiKey, oauth_nonce: crypto.randomBytes(16).toString('hex'), oauth_signature_method: 'HMAC-SHA1', oauth_timestamp: String(Math.floor(Date.now() / 1000)), oauth_version: '1.0' }, extra);
  o.oauth_signature = sign('POST', url, o, env.x.apiSecret, tokenSecret);
  const res = await fetch(url, { method: 'POST', headers: { Authorization: 'OAuth ' + Object.keys(o).sort().map((k) => pct(k) + '="' + pct(o[k]) + '"').join(', ') } });
  const text = await res.text();
  if (!res.ok) throw new Error('X ' + res.status + ': ' + text.slice(0, 200));
  return Object.fromEntries(new URLSearchParams(text));
}
async function xStart() {
  if (!env.x.apiKey || !env.x.apiSecret) throw new Error('Save the X API key and secret first.');
  const r = await oauth1('https://api.x.com/oauth/request_token', { oauth_callback: callbackUrl('x') });
  if (r.oauth_callback_confirmed !== 'true') throw new Error('X rejected the callback URL. Add ' + callbackUrl('x') + ' to the app\'s callback URLs.');
  db.kvSet('oauthState', Object.assign(db.kvGet('oauthState', {}), { x: { s: r.oauth_token, secret: r.oauth_token_secret, at: Date.now() } }));
  return 'https://api.x.com/oauth/authorize?oauth_token=' + encodeURIComponent(r.oauth_token);
}
async function xCallback(q) {
  const st = (db.kvGet('oauthState', {}) || {}).x;
  if (!st || st.s !== q.oauth_token || Date.now() - st.at > 15 * 60000) throw new Error('Sign-in expired, try again.');
  if (q.denied) throw new Error('Access was denied on X.');
  const r = await oauth1('https://api.x.com/oauth/access_token', { oauth_token: q.oauth_token, oauth_verifier: q.oauth_verifier }, st.secret);
  if (!r.oauth_token || !r.oauth_token_secret) throw new Error('X returned no access token');
  secrets.save({ x: { accessToken: r.oauth_token, accessSecret: r.oauth_token_secret, handle: r.screen_name || env.x.handle } });
  return 'X connected as @' + (r.screen_name || '');
}

const FLOWS = {
  youtube: { start: youtubeStart, callback: youtubeCallback },
  instagram: { start: instagramStart, callback: instagramCallback },
  threads: { start: threadsStart, callback: threadsCallback },
  x: { start: xStart, callback: xCallback }
};

module.exports = { FLOWS, callbackUrl };
