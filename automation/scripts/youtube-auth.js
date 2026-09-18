/**
 * One-time YouTube OAuth: prints a consent URL, receives the redirect on
 * localhost, and prints the refresh token to put in .env as YT_REFRESH_TOKEN.
 *
 *   YT_CLIENT_ID=... YT_CLIENT_SECRET=... node scripts/youtube-auth.js
 *
 * The OAuth client (Google Cloud console → Credentials) must be a "Desktop
 * app" or a "Web application" with http://localhost:8790/cb as a redirect URI.
 * Run it on your own computer, not on the VPS, so the browser can reach it.
 */
const http = require('http');
const { env } = require('../src/config');

const id = env.youtube.clientId, secret = env.youtube.clientSecret;
if (!id || !secret) { console.error('Set YT_CLIENT_ID and YT_CLIENT_SECRET first.'); process.exit(1); }
const redirect = 'http://localhost:8790/cb';
const url = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
  client_id: id, redirect_uri: redirect, response_type: 'code', access_type: 'offline', prompt: 'consent',
  scope: 'https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly'
});
console.log('\nOpen this URL in a browser signed in to the academy\'s YouTube channel:\n\n' + url + '\n');
http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://localhost');
  if (u.pathname !== '/cb') return res.end();
  const code = u.searchParams.get('code');
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: id, client_secret: secret, redirect_uri: redirect, grant_type: 'authorization_code' }) });
  const j = await r.json();
  if (!j.refresh_token) { res.end('No refresh token in the response: ' + JSON.stringify(j)); console.error(j); return; }
  res.end('Done. Return to the terminal.');
  console.log('\nYT_REFRESH_TOKEN=' + j.refresh_token + '\n\nPut that in .env on the server.');
  process.exit(0);
}).listen(8790);
