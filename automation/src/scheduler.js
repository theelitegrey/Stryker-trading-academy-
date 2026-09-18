/**
 * The tick, every settings.tickMinutes:
 *
 *   1. producers      enqueue anything new (brief, calendar, monitor, lesson…)
 *   2. draft          'ready' → captions (+ script) via Claude → card → 'drafted'
 *                     text-only posts go straight to 'approved'
 *   3. render         'drafted' video posts → MP4 → 'approved' after the
 *                     preview window
 *   4. publish        'approved' posts whose time has come, one per platform
 *                     per tick, within each platform's pacing
 *
 * Overlapping ticks are prevented in-process (a render can outlast a tick)
 * and by status claims in the database.
 */
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { env } = require('./config');
const db = require('./db');
const log = require('./log');
const producers = require('./producers');
const Draft = require('./draft/claude');
const Cards = require('./render/cards');
const Video = require('./render/video');
const Publish = require('./publish');
const Meta = require('./publish/meta');
const { utcDate } = require('./util');

let running = false;

function holdWanted(post, s) {
  return Array.isArray(s.holdKinds) && s.holdKinds.includes(post.kind);
}

// ---- 2. draft ---------------------------------------------------------------------

async function draftOne(post, s) {
  if (!db.claim(post.id, 'ready', 'drafting')) return;
  try {
    if (!env.anthropicApiKey) throw new Error('ANTHROPIC_API_KEY is not set');
    const thread = post.kind === 'brief';
    const captions = await Draft.draftCaptions(post, { xLink: Publish.xWantsLink(post, s), thread });
    const usage = { captions: captions.usage };
    let script = null;
    if (post.video) { script = await Draft.draftScript(post); usage.script = script.usage; }

    const media = await makeCard(post, captions, s);

    const next = post.video ? 'drafted' : (holdWanted(post, s) ? 'queued' : 'approved');
    db.update(post.id, { drafts: captions, script, media, usage, status: next, error: null });
    log.info('drafted', post.id, '→', next);
  } catch (e) {
    log.error('draft failed for', post.id, e.message);
    db.update(post.id, { status: 'failed', error: 'Draft: ' + String(e.message || e).slice(0, 400) });
  }
}

/** Renders the card for a post: SVG for preview, PNG for X, JPEG for Instagram/Threads. */
async function makeCard(post, drafts, s) {
  const media = {};
  try {
    const svg = Cards.cardFor(post, drafts, s.cardStyles);
    const png = await Cards.renderPng(svg);
    if (png) {
      const dir = path.join(env.dataDir, 'media'); fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, post.id + '.card.png'), png);
      fs.writeFileSync(path.join(dir, post.id + '.card.svg'), svg);
      media.cardPng = `media/${post.id}.card.png`;
      media.cardSvg = `media/${post.id}.card.svg`;
      await toJpeg(path.join(dir, post.id + '.card.png'), path.join(dir, post.id + '.card.jpg'));
      media.cardJpg = `media/${post.id}.card.jpg`;
    }
  } catch (e) { log.warn('card failed for', post.id, e.message); }
  return media;
}

function toJpeg(png, jpg) {
  return new Promise((resolve, reject) => {
    execFile(Video.ffmpegPath(), ['-y', '-loglevel', 'error', '-i', png, '-q:v', '3', jpg], (err) => (err ? reject(err) : resolve()));
  });
}

// ---- 3. render ---------------------------------------------------------------------

async function renderOne(post, s) {
  if (!db.claim(post.id, 'drafted', 'rendering')) return;
  try {
    if (!post.script) throw new Error('No script to render');
    const r = await Video.build(post, post.script, { voice: s.voice, musicDb: s.musicDb });
    const media = Object.assign({}, post.media || {}, { video: r.video, poster: r.poster, seconds: r.seconds, voiced: r.voiced, engine: r.engine });
    const t = Date.now();
    const scheduledForMs = Math.max(post.scheduledForMs || t, t + (s.videoPreviewMinutes || 0) * 60000);
    db.update(post.id, { media, status: holdWanted(post, s) ? 'queued' : 'approved', scheduledForMs, error: null });
  } catch (e) {
    log.error('render failed for', post.id, e.message);
    db.update(post.id, { status: 'failed', error: 'Render: ' + String(e.message || e).slice(0, 400) });
  }
}

// ---- 4. publish ---------------------------------------------------------------------

function pacingAllows(platform, s, state, t, ignoreGap) {
  const p = (s.pacing || {})[platform] || { minGapMinutes: 60, maxPerDay: 3 };
  const ps = (state.platforms || {})[platform] || {};
  const day = utcDate(t);
  const count = ps.day === day ? (ps.count || 0) : 0;
  if (count >= p.maxPerDay) return { ok: false, why: 'daily cap' };
  if (!ignoreGap && t - (ps.lastPostAtMs || 0) < p.minGapMinutes * 60000) return { ok: false, why: 'gap' };
  return { ok: true };
}

function notePosted(platform, t) {
  const state = db.state();
  const day = utcDate(t);
  const ps = (state.platforms || {})[platform] || {};
  const platforms = Object.assign({}, state.platforms || {}, { [platform]: { lastPostAtMs: t, day, count: (ps.day === day ? ps.count || 0 : 0) + 1 } });
  db.patchState({ platforms, lastPostAtMs: t, lastPostId: null });
}

async function publishDue(s, t) {
  const configured = Publish.configured(s);
  const usedThisTick = new Set();
  for (const post of db.byStatus('approved')) {
    if (post.expiresAtMs && post.expiresAtMs < t) { db.update(post.id, { status: 'skipped', error: 'Missed its window.' }); continue; }
    if ((post.scheduledForMs || 0) > t) continue;
    if (!post.drafts) continue;
    const results = Object.assign({}, post.results || {});
    const pending = post.platforms.filter((p) => !(results[p] && results[p].id));
    if (!pending.length) { db.update(post.id, { status: 'posted', postedAtMs: post.postedAtMs || t }); continue; }
    if (!db.claim(post.id, 'approved', 'posting')) continue;

    for (const platform of pending) {
      if (usedThisTick.has(platform)) continue;
      if (!s.platforms[platform]) { results[platform] = { error: 'Platform disabled in settings', at: t, final: true }; continue; }
      if (!configured[platform]) { results[platform] = { error: 'Credentials not set on the server', at: t, final: true }; continue; }
      const pace = pacingAllows(platform, s, db.state(), t, post.kind === 'calendar');
      if (!pace.ok) continue;
      usedThisTick.add(platform);
      try {
        const r = await Publish.publish(platform, post, s);
        results[platform] = Object.assign({ at: t }, r);
        notePosted(platform, t);
        log.info('posted', post.id, 'to', platform, r.url || r.id);
      } catch (e) {
        const msg = String(e.message || e).slice(0, 400);
        const prev = results[platform] || {};
        results[platform] = { error: msg, at: t, attempts: (prev.attempts || 0) + 1, final: (prev.attempts || 0) + 1 >= 3 };
        log.error('post failed', post.id, platform, msg);
      }
    }

    const done = post.platforms.filter((p) => results[p] && results[p].id);
    const dead = post.platforms.filter((p) => results[p] && results[p].error && results[p].final);
    let status = 'approved';
    if (done.length === post.platforms.length) status = 'posted';
    else if (done.length + dead.length === post.platforms.length) status = done.length ? 'partial' : 'failed';
    db.update(post.id, { results, status, postedAtMs: done.length ? (post.postedAtMs || t) : null,
      error: dead.length ? dead.map((p) => p + ': ' + results[p].error).join(' | ') : null });
    if (status === 'posted' || status === 'partial') db.patchState({ lastPostId: post.id });
  }
}

// ---- the tick -----------------------------------------------------------------------

async function tick(reason) {
  if (running) { log.warn('tick skipped: previous still running'); return { ran: false }; }
  running = true;
  const t = Date.now();
  try {
    const s = db.settings();
    if (!s.enabled) { db.patchState({ lastTickAtMs: t, lastTickReason: reason || 'schedule' }); return { ran: false }; }

    await producers.runAll(s, t);

    for (const post of db.byStatus('ready').slice(0, 3)) await draftOne(post, s);
    for (const post of db.byStatus('drafted').filter((p) => p.video).slice(0, 1)) await renderOne(post, s);
    // Text-only posts that landed in 'drafted' (e.g. a video kind switched off) still publish.
    for (const post of db.byStatus('drafted').filter((p) => !p.video)) db.update(post.id, { status: 'approved' });
    await publishDue(s, t);

    const st = db.state();
    if (!st.tokensCheckedDay || st.tokensCheckedDay !== utcDate(t)) {
      await Meta.refreshTokens();
      db.patchState({ tokensCheckedDay: utcDate(t) });
    }
    db.patchState({ lastTickAtMs: t, lastTickReason: reason || 'schedule', lastError: null });
    return { ran: true };
  } catch (e) {
    log.error('tick failed:', e);
    db.patchState({ lastTickAtMs: t, lastError: String(e.message || e).slice(0, 400) });
    return { ran: false, error: e.message };
  } finally { running = false; }
}

/** Re-runs drafting for one post (admin "Redraft"). */
async function redraft(id) {
  const post = db.getPost(id);
  if (!post) throw new Error('No such post');
  db.update(id, { status: 'ready', drafts: null, script: null, media: null, results: null, error: null });
  await draftOne(db.getPost(id), db.settings());
  return db.getPost(id);
}

module.exports = { tick, redraft, pacingAllows, draftOne, renderOne, publishDue, makeCard };
