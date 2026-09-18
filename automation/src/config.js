/**
 * Stryker social automation — configuration
 *
 * Two layers:
 *   env       secrets and server facts, read once from process.env (and a
 *             .env file next to package.json if present). Never stored in
 *             the database, never shown on the admin page.
 *   settings  operating knobs (times, caps, which platforms are on), stored
 *             in the SQLite settings table and editable from the admin page.
 *             DEFAULT_SETTINGS is the full list; anything saved overrides it.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function loadDotEnv() {
  const file = path.join(ROOT, '.env');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m || line.trim().startsWith('#')) continue;
    if (process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
loadDotEnv();

const e = (k, d) => (process.env[k] !== undefined && process.env[k] !== '' ? process.env[k] : d);

const env = {
  root: ROOT,
  publicBaseUrl: String(e('PUBLIC_BASE_URL', 'http://localhost:8787')).replace(/\/$/, ''),
  port: Number(e('PORT', 8787)),
  adminPassword: e('ADMIN_PASSWORD', ''),
  dataDir: path.resolve(ROOT, e('DATA_DIR', './data')),
  siteUrl: String(e('SITE_URL', 'https://strykertrading.com')).replace(/\/$/, ''),
  monitorUrl: e('MONITOR_URL', 'https://raw.githubusercontent.com/theelitegrey/Stryker-trading-academy-/data/monitor-data.json'),
  firebaseServiceAccount: e('FIREBASE_SERVICE_ACCOUNT', ''),
  anthropicApiKey: e('ANTHROPIC_API_KEY', ''),
  tts: {
    chatterboxUrl: e('CHATTERBOX_URL', ''),
    chatterboxVoice: e('CHATTERBOX_VOICE', ''),
    kokoroUrl: e('KOKORO_URL', ''),
    kokoroVoice: e('KOKORO_VOICE', 'am_michael')
  },
  x: {
    apiKey: e('X_API_KEY', ''), apiSecret: e('X_API_SECRET', ''),
    accessToken: e('X_ACCESS_TOKEN', ''), accessSecret: e('X_ACCESS_SECRET', ''),
    handle: String(e('X_HANDLE', '')).replace(/^@/, '')
  },
  meta: {
    appId: e('META_APP_ID', ''), appSecret: e('META_APP_SECRET', ''),
    igUserId: e('IG_USER_ID', ''), igAccessToken: e('IG_ACCESS_TOKEN', ''),
    threadsAppId: e('THREADS_APP_ID', ''), threadsAppSecret: e('THREADS_APP_SECRET', ''),
    threadsUserId: e('THREADS_USER_ID', ''), threadsAccessToken: e('THREADS_ACCESS_TOKEN', '')
  },
  buffer: { token: e('BUFFER_API_KEY', '') },
  youtube: {
    clientId: e('YT_CLIENT_ID', ''), clientSecret: e('YT_CLIENT_SECRET', ''),
    refreshToken: e('YT_REFRESH_TOKEN', '')
  }
};

/** Operating settings. Every key here is editable on the admin page. */
const DEFAULT_SETTINGS = {
  enabled: false,
  tickMinutes: 10,

  // Which platforms receive posts at all. Credentials must also be set.
  platforms: { x: true, threads: true, instagram: true, youtube: true },

  // Pacing, per platform: never closer than minGapMinutes, never more than
  // maxPerDay in a UTC day. Calendar countdowns ignore the gap, not the cap.
  pacing: {
    x:         { minGapMinutes: 45, maxPerDay: 4 },
    threads:   { minGapMinutes: 45, maxPerDay: 4 },
    instagram: { minGapMinutes: 120, maxPerDay: 2 },
    youtube:   { minGapMinutes: 240, maxPerDay: 1 }
  },

  // Publish through Buffer (one API key, Buffer holds the platform
  // connections) instead of the direct platform APIs. Per platform, so X can
  // stay direct while Instagram and YouTube go through Buffer, or all four.
  buffer: { enabled: false, platforms: { x: true, threads: true, instagram: true, youtube: true }, channels: {} },

  // X charges more for a post that carries a link. 'all' links every post,
  // 'brief' only the daily brief, 'none' relies on the link in bio.
  xLinkPolicy: 'brief',

  // Producers and their times (UTC).
  brief:    { enabled: true, hour: 6, minute: 30, video: true },
  calendar: { enabled: true, leadMinutes: 30, video: false },
  monitor:  { enabled: true, maxPerDay: 2, video: false },
  lesson:   { enabled: true, hour: 12, minute: 0, video: true, days: [1, 2, 3, 4, 5, 6, 0] },
  promo:    { enabled: true, hour: 15, minute: 0, video: true, days: [2, 5] },
  feature:  { enabled: true, hour: 14, minute: 0, video: false },
  announce: { enabled: true, delayMinutes: 30, video: false },

  // Video posts wait this long after rendering before publishing, so an admin
  // can watch the preview and hold it.
  videoPreviewMinutes: 30,
  // Cards on text posts (X, Threads). Off means text only.
  cards: true,
  // Card style per kind; keys from the card renderer's STYLE_KEYS.
  cardStyles: {},
  // Voice: 'chatterbox' | 'kokoro' | 'auto' (chatterbox, then kokoro) | 'none'.
  voice: 'auto',
  // Music bed under narration, in dB below narration. 0 disables music.
  musicDb: -18
};

function deepMerge(a, b) {
  const out = Object.assign({}, a);
  for (const k of Object.keys(b || {})) {
    if (b[k] && typeof b[k] === 'object' && !Array.isArray(b[k]) && a && typeof a[k] === 'object' && !Array.isArray(a[k])) {
      out[k] = deepMerge(a[k], b[k]);
    } else out[k] = b[k];
  }
  return out;
}

module.exports = { env, DEFAULT_SETTINGS, deepMerge };
