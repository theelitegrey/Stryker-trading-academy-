/**
 * Admin HTTP server: the operator page, its JSON API, and the public
 * /media path that Instagram and Threads fetch videos from.
 *
 * Auth: HTTP Basic, user "admin", password ADMIN_PASSWORD, on everything
 * except /media and /healthz. Put Caddy (docker-compose.yml) in front for
 * TLS; the admin page is not usable over plain HTTP on a public box.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { env, DEFAULT_SETTINGS } = require('../config');
const db = require('../db');
const log = require('../log');
const scheduler = require('../scheduler');
const Publish = require('../publish');
const TTS = require('../tts');
const Cards = require('../render/cards');
const { utcDate, id: newId } = require('../util');

const MIME = { '.mp4': 'video/mp4', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.wav': 'audio/wav', '.html': 'text/html; charset=utf-8' };

function authed(req) {
  if (!env.adminPassword) return false;
  const h = req.headers.authorization || '';
  if (!h.startsWith('Basic ')) return false;
  const [user, pass] = Buffer.from(h.slice(6), 'base64').toString().split(':');
  const a = Buffer.from(pass || ''), b = Buffer.from(env.adminPassword);
  return user === 'admin' && a.length === b.length && crypto.timingSafeEqual(a, b);
}

function send(res, code, body, type) {
  const isObj = body && typeof body === 'object' && !Buffer.isBuffer(body);
  res.writeHead(code, { 'content-type': type || (isObj ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8'), 'cache-control': 'no-store' });
  res.end(isObj ? JSON.stringify(body) : body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 2e6) reject(new Error('Body too large')); });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(new Error('Bad JSON')); } });
  });
}

function serveMedia(req, res, rel) {
  const file = path.join(env.dataDir, 'media', path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(path.join(env.dataDir, 'media')) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return send(res, 404, 'Not found');
  const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
  const size = fs.statSync(file).size;
  const range = req.headers.range && req.headers.range.match(/bytes=(\d*)-(\d*)/);
  if (range) {
    const start = range[1] ? Number(range[1]) : 0;
    const end = range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    res.writeHead(206, { 'content-type': type, 'content-range': `bytes ${start}-${end}/${size}`, 'content-length': end - start + 1, 'accept-ranges': 'bytes' });
    return fs.createReadStream(file, { start, end }).pipe(res);
  }
  res.writeHead(200, { 'content-type': type, 'content-length': size, 'accept-ranges': 'bytes' });
  fs.createReadStream(file).pipe(res);
}

function snapshot() {
  const s = db.settings(); const st = db.state(); const t = Date.now(); const day = utcDate(t);
  const posts = db.recent(300);
  const counts = {};
  for (const p of Object.keys(s.platforms)) {
    const ps = (st.platforms || {})[p] || {};
    counts[p] = { today: ps.day === day ? ps.count || 0 : 0, lastPostAtMs: ps.lastPostAtMs || null };
  }
  return {
    now: t, settings: s, defaults: DEFAULT_SETTINGS, state: st, posts, counts,
    configured: Object.assign({ claude: !!env.anthropicApiKey, chatterbox: !!env.tts.chatterboxUrl, kokoro: !!env.tts.kokoroUrl, firestore: !!env.firebaseServiceAccount }, Publish.configured()),
    publicBaseUrl: env.publicBaseUrl, cardStyles: Cards.STYLE_KEYS, log: log.recent(150)
  };
}

async function api(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean);   // ['api', ...]
  const m = req.method;
  if (parts[1] === 'state' && m === 'GET') return send(res, 200, snapshot());
  if (parts[1] === 'settings' && m === 'POST') return send(res, 200, { settings: db.saveSettings(await readBody(req)) });
  if (parts[1] === 'tick' && m === 'POST') { const r = await scheduler.tick('admin'); return send(res, 200, Object.assign(r, { state: snapshot() })); }
  if (parts[1] === 'test' && m === 'POST') {
    const target = parts[2];
    try {
      if (target === 'chatterbox' || target === 'kokoro') return send(res, 200, { ok: true, result: await TTS.test(target) });
      if (target === 'claude') {
        const Draft = require('../draft/claude');
        const r = await Draft.draftCaptions({ kind: 'manual', title: 'Test', source: 'Stryker Trading Academy teaches ICT and smart-money trading.', instructions: 'Write a one-line hello from the academy.' }, {});
        return send(res, 200, { ok: true, result: { x: r.x[0], model: r.model } });
      }
      return send(res, 200, { ok: true, result: await Publish.test(target) });
    } catch (e) { return send(res, 200, { ok: false, error: String(e.message || e) }); }
  }
  if (parts[1] === 'manual' && m === 'POST') {
    const b = await readBody(req);
    const text = String(b.text || '').trim();
    if (!text) return send(res, 400, { error: 'Text required' });
    const s = db.settings();
    const platforms = Array.isArray(b.platforms) && b.platforms.length ? b.platforms : Object.keys(s.platforms).filter((p) => s.platforms[p] && p !== 'youtube');
    const pid = newId('manual');
    db.enqueue({ id: pid, kind: 'manual', title: b.title || text.slice(0, 60), video: false, platforms, priority: 4, scheduledForMs: Date.now(),
      linkPath: b.linkPath || null, campaign: 'manual', source: text,
      instructions: 'Post this text as written, adapting only length per platform. Keep the author\'s wording; do not add claims.' });
    if (b.verbatim) {
      const drafts = { x: [text], threads: text, instagram: text, youtube: { title: b.title || text.slice(0, 80), description: text, tags: [] }, cardTitle: b.title || '', cardBody: b.title ? text.slice(0, 300) : '', altText: b.title || text.slice(0, 200) };
      const media = b.title ? await scheduler.makeCard(db.getPost(pid), drafts, s) : {};
      db.update(pid, { status: 'approved', drafts, media });
    }
    return send(res, 200, { post: db.getPost(pid) });
  }
  if (parts[1] === 'posts' && parts[2]) {
    const pid = decodeURIComponent(parts[2]); const action = parts[3];
    const post = db.getPost(pid);
    if (!post) return send(res, 404, { error: 'No such post' });
    if (m === 'GET') return send(res, 200, { post });
    if (m === 'POST' && !action) {
      const b = await readBody(req);
      const patch = {};
      if (b.drafts) patch.drafts = Object.assign({}, post.drafts || {}, b.drafts);
      if (b.script) patch.script = b.script;
      if (b.scheduledForMs) patch.scheduledForMs = Number(b.scheduledForMs);
      if (Array.isArray(b.platforms)) patch.platforms = b.platforms;
      return send(res, 200, { post: db.update(pid, patch) });
    }
    if (m === 'POST' && action === 'hold') return send(res, 200, { post: db.update(pid, { status: 'queued' }) });
    if (m === 'POST' && action === 'approve') return send(res, 200, { post: db.update(pid, { status: post.video && !(post.media && post.media.video) ? 'drafted' : 'approved', error: null }) });
    if (m === 'POST' && action === 'post-now') return send(res, 200, { post: db.update(pid, { status: post.video && !(post.media && post.media.video) ? 'drafted' : 'approved', scheduledForMs: Date.now(), error: null }) });
    if (m === 'POST' && action === 'reject') return send(res, 200, { post: db.update(pid, { status: 'rejected' }) });
    if (m === 'POST' && action === 'retry') {
      const results = Object.assign({}, post.results || {});
      for (const k of Object.keys(results)) if (!results[k].id) delete results[k];
      const status = post.drafts ? (post.video && !(post.media && post.media.video) ? 'drafted' : 'approved') : 'ready';
      return send(res, 200, { post: db.update(pid, { status, results, error: null }) });
    }
    if (m === 'POST' && action === 'redraft') { try { return send(res, 200, { post: await scheduler.redraft(pid) }); } catch (e) { return send(res, 500, { error: e.message }); } }
    if (m === 'POST' && action === 'rerender') return send(res, 200, { post: db.update(pid, { status: 'drafted', error: null }) });
    if (m === 'DELETE' || (m === 'POST' && action === 'delete')) { db.remove(pid); return send(res, 200, { ok: true }); }
  }
  send(res, 404, { error: 'Unknown API route' });
}

function start() {
  const html = fs.readFileSync(path.join(__dirname, 'admin.html'));
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    try {
      if (url.pathname === '/healthz') return send(res, 200, { ok: true, lastTickAtMs: db.state().lastTickAtMs || null });
      if (url.pathname.startsWith('/media/')) return serveMedia(req, res, url.pathname.slice(7));
      if (!authed(req)) { res.writeHead(401, { 'www-authenticate': 'Basic realm="Stryker social"' }); return res.end('Sign in'); }
      if (url.pathname.startsWith('/api/')) return await api(req, res, url);
      if (url.pathname === '/' || url.pathname === '/index.html') return send(res, 200, html, MIME['.html']);
      send(res, 404, 'Not found');
    } catch (e) {
      log.error('http', req.method, url.pathname, e.message);
      send(res, 500, { error: String(e.message || e) });
    }
  });
  server.listen(env.port, () => log.info(`admin: listening on :${env.port} (${env.publicBaseUrl})`));
  return server;
}

module.exports = { start };
