/**
 * Curriculum and catalogue content: chapters (with lessons), models,
 * indicators, live sessions.
 *
 * Live from Firestore when FIREBASE_SERVICE_ACCOUNT points at a service
 * account JSON; otherwise from the bundled seed in ../assets/chapters-data.js
 * (the same content Firestore was seeded from), so the lesson producer works
 * on a box that has never seen Firebase.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { env } = require('../config');
const log = require('../log');

let app = null;
function firestore() {
  if (app) return app.firestore();
  if (!env.firebaseServiceAccount) return null;
  try {
    const admin = require('firebase-admin');
    const cred = JSON.parse(fs.readFileSync(path.resolve(env.root, env.firebaseServiceAccount), 'utf8'));
    if (!cred.project_id) throw new Error('service account JSON has no project_id');
    app = admin.apps.length ? admin.app() : admin.initializeApp({ credential: admin.credential.cert(cred) });
    return app.firestore();
  } catch (e) {
    log.warn('firestore: not available:', e.message);
    return null;
  }
}

function stripHtml(s) {
  return String(s || '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();
}

let seedCache = null;
function seedChapters() {
  if (seedCache) return seedCache;
  const file = path.join(env.root, '..', 'assets', 'chapters-data.js');
  if (!fs.existsSync(file)) return [];
  const src = fs.readFileSync(file, 'utf8');
  const sandbox = {};
  try {
    vm.runInNewContext(src + '\n;__out = typeof CHAPTERS_SEED !== "undefined" ? CHAPTERS_SEED : [];', sandbox, { timeout: 2000 });
  } catch (e) { log.warn('seed chapters failed to parse:', e.message); return []; }
  seedCache = (sandbox.__out || []).map(normaliseChapter);
  return seedCache;
}

function normaliseChapter(c, id) {
  return {
    id: id || c.id || c.num,
    num: String(c.num || ''), title: c.title || '', level: c.level || null, dur: c.dur || null,
    paragraphs: (c.paragraphs || []).map(stripHtml).filter(Boolean),
    lessons: (c.lessons || []).map((l) => { const a = stripHtml(l.descHtml || ''), b = stripHtml(l.desc || l.text || ''); return { title: l.title || '', text: a.length > b.length ? a : b }; }).filter((l) => l.title)
  };
}

async function chapters() {
  const fsdb = firestore();
  if (fsdb) {
    try {
      const snap = await fsdb.collection('chapters').get();
      const list = [];
      snap.forEach((d) => list.push(normaliseChapter(d.data(), d.id)));
      list.sort((a, b) => a.num.localeCompare(b.num, undefined, { numeric: true }));
      if (list.length) return list;
    } catch (e) { log.warn('firestore chapters failed, using seed:', e.message); }
  }
  return seedChapters();
}

/** New documents created after `sinceMs` in a collection, for announcements. */
async function createdSince(collection, sinceMs) {
  const fsdb = firestore();
  if (!fsdb) return [];
  try {
    const snap = await fsdb.collection(collection).get();
    const out = [];
    snap.forEach((d) => {
      const x = d.data();
      const created = x.createdAtMillis || (x.createdAt && x.createdAt.toMillis ? x.createdAt.toMillis() : null) || x.startAtMillis || null;
      if (created && created > sinceMs) out.push(Object.assign({ id: d.id, createdMs: created }, x));
    });
    return out;
  } catch (e) { log.warn('firestore', collection, 'failed:', e.message); return []; }
}

module.exports = { chapters, createdSince, stripHtml, seedChapters, available: () => !!firestore() };
