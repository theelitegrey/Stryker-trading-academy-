/**
 * YouTube Data API v3: resumable upload of a Short. OAuth2 with a refresh
 * token minted once by scripts/youtube-auth.js.
 *
 * Quota: an upload costs 1 unit against a separate daily upload bucket (since
 * June 2026); the default project quota is more than enough at one a day.
 * Until the project passes YouTube's API audit, uploads from it are set to
 * private by YouTube regardless of privacyStatus — see SETUP.md.
 */
const fs = require('fs');
const { env } = require('../config');

async function accessToken() {
  const y = env.youtube;
  if (!y.clientId || !y.clientSecret || !y.refreshToken) throw new Error('YouTube credentials not set');
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: y.clientId, client_secret: y.clientSecret, refresh_token: y.refreshToken, grant_type: 'refresh_token' })
  });
  const j = await res.json();
  if (!res.ok || !j.access_token) throw new Error('YouTube token refresh failed: ' + (j.error_description || j.error || res.status));
  return j.access_token;
}

async function whoAmI() {
  const tok = await accessToken();
  const res = await fetch('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true', { headers: { authorization: 'Bearer ' + tok } });
  const j = await res.json();
  if (!res.ok) throw new Error('YouTube ' + res.status + ': ' + JSON.stringify(j).slice(0, 200));
  const ch = (j.items || [])[0];
  return ch ? { id: ch.id, title: ch.snippet.title } : null;
}

/** Uploads an MP4. Returns {id, url}. */
async function upload({ file, title, description, tags, privacy }) {
  const tok = await accessToken();
  const bytes = fs.readFileSync(file);
  const meta = {
    snippet: { title: String(title).slice(0, 100), description: String(description || '').slice(0, 5000), tags: (tags || []).slice(0, 15), categoryId: '27' },
    status: { privacyStatus: privacy || 'public', selfDeclaredMadeForKids: false }
  };
  const init = await fetch('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status', {
    method: 'POST',
    headers: { authorization: 'Bearer ' + tok, 'content-type': 'application/json; charset=UTF-8',
      'x-upload-content-type': 'video/mp4', 'x-upload-content-length': String(bytes.length) },
    body: JSON.stringify(meta)
  });
  if (!init.ok) throw new Error('YouTube upload init ' + init.status + ': ' + (await init.text()).slice(0, 300));
  const loc = init.headers.get('location');
  if (!loc) throw new Error('YouTube upload init returned no session URL');
  const put = await fetch(loc, { method: 'PUT', headers: { authorization: 'Bearer ' + tok, 'content-type': 'video/mp4', 'content-length': String(bytes.length) }, body: bytes });
  const j = await put.json().catch(() => ({}));
  if (!put.ok || !j.id) throw new Error('YouTube upload ' + put.status + ': ' + JSON.stringify(j).slice(0, 300));
  return { id: j.id, url: 'https://youtube.com/shorts/' + j.id };
}

module.exports = { whoAmI, upload, accessToken };
