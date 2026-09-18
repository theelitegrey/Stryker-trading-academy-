const crypto = require('crypto');

const now = () => Date.now();
function utcDate(ms) { return new Date(ms).toISOString().slice(0, 10); }
function utcDay(ms) { return new Date(ms).getUTCDay(); }
function isWeekday(ms) { const d = utcDay(ms); return d >= 1 && d <= 5; }
function minutesOfDay(ms) { const d = new Date(ms); return d.getUTCHours() * 60 + d.getUTCMinutes(); }

function slug(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
}

function id(prefix) {
  return (prefix ? prefix + '-' : '') + crypto.randomBytes(6).toString('hex');
}

/** UTM-tagged link to a site path. `source` is the platform name. */
function utmLink(siteUrl, path, source, campaign) {
  const u = new URL(path, siteUrl + '/');
  u.searchParams.set('utm_source', source);
  u.searchParams.set('utm_medium', 'social');
  u.searchParams.set('utm_campaign', campaign);
  return u.toString();
}

async function fetchJson(url, { timeoutMs = 15000, headers } = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctl.signal, headers: Object.assign({ 'cache-control': 'no-cache' }, headers || {}) });
    if (!res.ok) throw new Error(`${res.status} from ${url}`);
    return await res.json();
  } finally { clearTimeout(t); }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function truncate(s, n) {
  s = String(s || '');
  return s.length <= n ? s : s.slice(0, n - 1).replace(/\s+\S*$/, '') + '…';
}

/** Duration in seconds of a PCM WAV buffer, read from its header. */
function wavDuration(buf) {
  if (!buf || buf.length < 44 || buf.toString('ascii', 0, 4) !== 'RIFF') return null;
  let off = 12; let byteRate = null; let dataLen = null;
  while (off + 8 <= buf.length) {
    const tag = buf.toString('ascii', off, off + 4);
    const len = buf.readUInt32LE(off + 4);
    if (tag === 'fmt ') byteRate = buf.readUInt32LE(off + 16);
    if (tag === 'data') { dataLen = Math.min(len, buf.length - off - 8); break; }
    off += 8 + len + (len % 2);
  }
  if (!byteRate || dataLen == null) return null;
  return dataLen / byteRate;
}

module.exports = { now, utcDate, utcDay, isWeekday, minutesOfDay, slug, id, utmLink, fetchJson, sleep, truncate, wavDuration };
