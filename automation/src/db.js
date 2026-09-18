/**
 * SQLite storage: the post queue, per-platform state, settings, tokens.
 *
 * posts.id is the de-duplication key, exactly as in the X pipeline: one
 * brief per session, one countdown per event, one lesson per day. An insert
 * of an existing id is a no-op, so a crashed run cannot double-post.
 *
 * Status lifecycle:
 *   ready      enqueued, not yet drafted
 *   drafted    text written; a video kind still needs rendering
 *   rendering  video being built (claimed by one tick)
 *   queued     held by an admin
 *   approved   will publish when scheduledForMs passes and pacing allows
 *   posting    claimed by one tick
 *   posted     every platform done (results per platform)
 *   partial    some platforms done, some failed; admin can retry the rest
 *   failed     drafting, rendering or every platform failed
 *   rejected   admin said no; never recreated (delete the row to allow it)
 *   skipped    missed its window
 */

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { env, DEFAULT_SETTINGS, deepMerge } = require('./config');

let db;

function open(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS posts (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      status TEXT NOT NULL,
      title TEXT,
      platforms TEXT NOT NULL,       -- JSON array
      video INTEGER NOT NULL DEFAULT 0,
      instructions TEXT,
      source TEXT,                   -- JSON or prose given to the model
      linkPath TEXT,
      campaign TEXT,
      drafts TEXT,                   -- JSON: per-platform text, card, figures
      script TEXT,                   -- JSON: video scenes
      media TEXT,                    -- JSON: {card, video, poster} relative paths
      results TEXT,                  -- JSON: per-platform {id,url,at} or {error}
      priority INTEGER NOT NULL DEFAULT 5,
      scheduledForMs INTEGER,
      expiresAtMs INTEGER,
      createdAtMs INTEGER NOT NULL,
      updatedAtMs INTEGER NOT NULL,
      postedAtMs INTEGER,
      error TEXT,
      usage TEXT                     -- JSON: model token usage
    );
    CREATE INDEX IF NOT EXISTS posts_status ON posts(status);
    CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL);
  `);
  return db;
}

function get() { if (!db) open(path.join(env.dataDir, 'social.sqlite')); return db; }

// ---- kv: settings, state, tokens -------------------------------------------------

function kvGet(k, d) {
  const r = get().prepare('SELECT v FROM kv WHERE k = ?').get(k);
  return r ? JSON.parse(r.v) : d;
}
function kvSet(k, v) {
  get().prepare('INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v').run(k, JSON.stringify(v));
}
function settings() { return deepMerge(DEFAULT_SETTINGS, kvGet('settings', {})); }
function saveSettings(patch) { kvSet('settings', deepMerge(kvGet('settings', {}), patch)); return settings(); }
function state() { return kvGet('state', {}); }
function patchState(patch) { kvSet('state', Object.assign(state(), patch)); }

// ---- posts ---------------------------------------------------------------------

const J = (v) => (v == null ? null : JSON.stringify(v));
const P = (v) => (v == null ? null : JSON.parse(v));

function rowToPost(r) {
  if (!r) return null;
  return Object.assign({}, r, {
    platforms: P(r.platforms) || [], drafts: P(r.drafts), script: P(r.script),
    media: P(r.media), results: P(r.results), usage: P(r.usage), video: !!r.video
  });
}

/** Inserts if the id is new. Returns true when created. */
function enqueue(post) {
  const t = Date.now();
  const r = get().prepare(`INSERT OR IGNORE INTO posts
    (id, kind, status, title, platforms, video, instructions, source, linkPath, campaign, priority, scheduledForMs, expiresAtMs, createdAtMs, updatedAtMs)
    VALUES (@id, @kind, 'ready', @title, @platforms, @video, @instructions, @source, @linkPath, @campaign, @priority, @scheduledForMs, @expiresAtMs, @t, @t)`)
    .run({
      id: post.id, kind: post.kind, title: post.title || null, platforms: JSON.stringify(post.platforms || []),
      video: post.video ? 1 : 0, instructions: post.instructions || null,
      source: typeof post.source === 'string' ? post.source : JSON.stringify(post.source || null),
      linkPath: post.linkPath || null, campaign: post.campaign || null, priority: post.priority == null ? 5 : post.priority,
      scheduledForMs: post.scheduledForMs || null, expiresAtMs: post.expiresAtMs || null, t
    });
  return r.changes > 0;
}

function update(id, patch) {
  const sets = []; const vals = { id, t: Date.now() };
  for (const k of Object.keys(patch)) {
    sets.push(`${k} = @${k}`);
    const v = patch[k];
    vals[k] = (['platforms', 'drafts', 'script', 'media', 'results', 'usage'].includes(k)) ? J(v)
      : (k === 'video' ? (v ? 1 : 0) : v);
  }
  sets.push('updatedAtMs = @t');
  get().prepare(`UPDATE posts SET ${sets.join(', ')} WHERE id = @id`).run(vals);
  return getPost(id);
}

/** Atomic status transition: returns true only if the row was in `from`. */
function claim(id, from, to) {
  const r = get().prepare('UPDATE posts SET status = ?, updatedAtMs = ? WHERE id = ? AND status = ?').run(to, Date.now(), id, from);
  return r.changes > 0;
}

function getPost(id) { return rowToPost(get().prepare('SELECT * FROM posts WHERE id = ?').get(id)); }
function byStatus(...statuses) {
  const q = statuses.map(() => '?').join(',');
  return get().prepare(`SELECT * FROM posts WHERE status IN (${q}) ORDER BY priority, scheduledForMs, createdAtMs`).all(...statuses).map(rowToPost);
}
function recent(limit) {
  return get().prepare('SELECT * FROM posts ORDER BY updatedAtMs DESC LIMIT ?').all(limit || 100).map(rowToPost);
}
function exists(id) { return !!get().prepare('SELECT 1 FROM posts WHERE id = ?').get(id); }
function remove(id) { get().prepare('DELETE FROM posts WHERE id = ?').run(id); }
function countKindOnDay(kind, day) {
  const start = Date.parse(day + 'T00:00:00Z'); const end = start + 86400000;
  return get().prepare('SELECT COUNT(*) AS n FROM posts WHERE kind = ? AND createdAtMs >= ? AND createdAtMs < ? AND status != ?').get(kind, start, end, 'rejected').n;
}

module.exports = { open, get, kvGet, kvSet, settings, saveSettings, state, patchState,
  enqueue, update, claim, getPost, byStatus, recent, exists, remove, countKindOnDay };
