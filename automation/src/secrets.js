/**
 * Secrets saved from the admin page (API keys, tokens from the Connect
 * buttons). They live in the kv table under 'secrets' and are laid over
 * `env` at startup and after every save, so a key pasted on the admin page
 * works exactly like one in .env. A .env value is the fallback when the
 * saved one is empty.
 *
 * Shape mirrors env: { anthropicApiKey, tts: {chatterboxVoice, kokoroVoice},
 *   x: {apiKey, apiSecret, accessToken, accessSecret, handle},
 *   meta: {appId, appSecret, threadsAppId, threadsAppSecret, igUserId, igAccessToken, threadsUserId, threadsAccessToken},
 *   youtube: {clientId, clientSecret, refreshToken},
 *   firebaseServiceAccountJson }
 */
const fs = require('fs');
const path = require('path');
const { env } = require('./config');
const db = require('./db');

const BASE = JSON.parse(JSON.stringify({ anthropicApiKey: env.anthropicApiKey, tts: env.tts, x: env.x, meta: env.meta, youtube: env.youtube }));

function overlay(target, base, saved) {
  for (const k of Object.keys(base)) {
    if (base[k] && typeof base[k] === 'object') overlay(target[k], base[k], (saved || {})[k]);
    else target[k] = (saved && saved[k] !== undefined && saved[k] !== '') ? saved[k] : base[k];
  }
}

function apply() {
  const saved = db.kvGet('secrets', {});
  overlay(env, BASE, saved);
  if (saved.meta && saved.meta.threadsAppId) env.meta.threadsAppId = saved.meta.threadsAppId;
  if (saved.meta && saved.meta.threadsAppSecret) env.meta.threadsAppSecret = saved.meta.threadsAppSecret;
  if (saved.firebaseServiceAccountJson) {
    const f = path.join(env.dataDir, 'service-account.json');
    try {
      if (!fs.existsSync(f) || fs.readFileSync(f, 'utf8') !== saved.firebaseServiceAccountJson) fs.writeFileSync(f, saved.firebaseServiceAccountJson, { mode: 0o600 });
      env.firebaseServiceAccount = f;
    } catch (e) { /* leave env as is */ }
  }
  return saved;
}

function get() { return db.kvGet('secrets', {}); }

/** Deep-merges a patch into the saved secrets; empty strings clear a value. */
function save(patch) {
  const cur = get();
  const merge = (a, b) => {
    for (const k of Object.keys(b || {})) {
      if (b[k] && typeof b[k] === 'object' && !Array.isArray(b[k])) { a[k] = a[k] && typeof a[k] === 'object' ? a[k] : {}; merge(a[k], b[k]); }
      else a[k] = b[k];
    }
    return a;
  };
  db.kvSet('secrets', merge(cur, patch));
  return apply();
}

/** What the admin page may see: which values are set, never the values. */
function masked() {
  const m = (v) => (v ? '•••' + String(v).slice(-4) : '');
  return {
    anthropicApiKey: m(env.anthropicApiKey),
    tts: { chatterboxVoice: env.tts.chatterboxVoice || '', kokoroVoice: env.tts.kokoroVoice || '' },
    x: { apiKey: m(env.x.apiKey), apiSecret: m(env.x.apiSecret), accessToken: m(env.x.accessToken), accessSecret: m(env.x.accessSecret), handle: env.x.handle || '' },
    meta: { appId: env.meta.appId || '', appSecret: m(env.meta.appSecret), threadsAppId: env.meta.threadsAppId || '', threadsAppSecret: m(env.meta.threadsAppSecret),
      igUserId: env.meta.igUserId || '', igAccessToken: m(env.meta.igAccessToken), threadsUserId: env.meta.threadsUserId || '', threadsAccessToken: m(env.meta.threadsAccessToken) },
    youtube: { clientId: env.youtube.clientId || '', clientSecret: m(env.youtube.clientSecret), refreshToken: m(env.youtube.refreshToken) },
    firebase: !!env.firebaseServiceAccount
  };
}

module.exports = { apply, get, save, masked };
