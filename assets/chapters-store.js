// Stryker Trading Academy — live chapters store
// Depends on: assets/progress.js (for `db`), and assets/chapters-index.js
// (the catalog-only CHAPTERS_SEED fallback) if that script is also loaded.
//
// chapters/{num} is the CATALOG: title, level, lesson titles, teaser.
// chapterBodies/{num} holds the chapter text and is gated by plan in the
// Firestore rules; fetch it with loadChapterBody(num) (the reader and the
// chapter editor are the only callers).
//
// All pages that display chapter content must call `await loadChapters()`
// before reading the CHAPTERS array — unlike the old static file, this is
// no longer synchronously available at parse time.

let CHAPTERS = [];          // the core curriculum (01..42) only
let TRACK_CHAPTERS = [];    // specialist-track chapters (ids like VP-01), paid
let _chaptersLoadPromise = null;

// Specialist tracks. Chapters carry `track`; anything without one (or
// 'core') is the core curriculum. Order here = order on /courses.
const TRACKS = [
  { id: 'vp', name: 'Volume Profile & Order Flow', blurb: 'Auction theory, profiles, VWAP, the order book, footprint and delta.' },
  { id: 'pf', name: 'Prop Firm Mastery', blurb: 'How prop firms work, how to vet one, the rules, passing and staying funded.',
    // Optional link under the blurb on /courses (copy from content-developer).
    link: { href: 'prop-firm-cheat-sheet', lead: 'PLACEHOLDER track line.', label: 'PLACEHOLDER link label' } }
];
function isTrackChapter(ch){ return !!(ch && ch.track && ch.track !== 'core'); }
function trackOf(id){ return TRACKS.find((t) => t.id === id) || null; }
let CHAPTERS_FROM_SEED = false;
function splitChapters(all){
  CHAPTERS_FROM_SEED = (typeof CHAPTERS_SEED !== 'undefined' && all === CHAPTERS_SEED);
  const core = [], tracks = [];
  (all || []).forEach((c) => (isTrackChapter(c) ? tracks : core).push(c));
  core.sort((a, b) => a.num.localeCompare(b.num));
  const trackIdx = (c) => { const i = TRACKS.findIndex((t) => t.id === c.track); return i < 0 ? 99 : i; };
  tracks.sort((a, b) => trackIdx(a) - trackIdx(b) || a.num.localeCompare(b.num));
  TRACK_CHAPTERS = tracks;
  return core;
}

function loadChapters(forceRefresh){
  if (_chaptersLoadPromise && !forceRefresh) return _chaptersLoadPromise;

  if (!db) {
    // Firestore never initialized — fall back to bundled content instead of
    // leaving the page stuck on "Loading chapter…" forever.
    CHAPTERS = splitChapters(typeof CHAPTERS_SEED !== 'undefined' ? CHAPTERS_SEED : []);
    _chaptersLoadPromise = Promise.resolve(CHAPTERS);
    return _chaptersLoadPromise;
  }

  _chaptersLoadPromise = db.collection('chapters').get()
    .then((snap) => {
      const list = [];
      snap.forEach((doc) => list.push(normalizeCatalogEntry(doc.data())));
      if (!list.length && typeof CHAPTERS_SEED !== 'undefined') {
        // Firestore hasn't been seeded yet — fall back to the bundled data
        // so the site still works, rather than showing an empty curriculum.
        CHAPTERS = splitChapters(CHAPTERS_SEED);
      } else {
        CHAPTERS = splitChapters(list);
      }
      return CHAPTERS;
    })
    .catch((err) => {
      console.error('Stryker: failed to load chapters from Firestore', err);
      if (typeof CHAPTERS_SEED !== 'undefined') {
        CHAPTERS = splitChapters(CHAPTERS_SEED);
      }
      return CHAPTERS;
    });

  return _chaptersLoadPromise;
}

// Catalog docs carry `preview` (the teaser) and `readMinutes`. Until the
// migration strips the legacy full-text fields from chapters/*, derive them
// from those fields so both shapes render the same.
function normalizeCatalogEntry(ch){
  if (!ch) return ch;
  if (ch.preview == null) ch.preview = String((ch.paragraphs || [])[0] || '').replace(/<[^>]*>/g, '');
  if (!Array.isArray(ch.lessons)) ch.lessons = [];
  return ch;
}

// The chapter text. Resolves to { bodyHtml, paragraphs, lessons[{title,
// desc, descHtml}], video } or null when this reader's plan doesn't cover it
// (Firestore refuses the read) or it doesn't exist. Rejects only on network
// or other unexpected errors, so callers can tell "locked" from "broken".
//
// Legacy fallback: while chapters/* still carries the full text (before the
// migration's strip step), a missing chapterBodies doc falls back to it.
const _chapterBodyCache = {};
function loadChapterBody(num, forceRefresh){
  if (!num) return Promise.resolve(null);
  if (_chapterBodyCache[num] && !forceRefresh) return _chapterBodyCache[num];
  const legacy = () => {
    const ch = (CHAPTERS || []).find((c) => c.num === num);
    return (ch && (ch.bodyHtml || (ch.paragraphs && ch.paragraphs.length)))
      ? { bodyHtml: ch.bodyHtml || '', paragraphs: ch.paragraphs || [], lessons: ch.lessons || [], video: ch.video || '' }
      : null;
  };
  if (typeof db === 'undefined' || !db) return Promise.resolve(legacy());
  _chapterBodyCache[num] = db.collection('chapterBodies').doc(num).get()
    .then((doc) => (doc.exists ? doc.data() : legacy()))
    .catch((err) => {
      delete _chapterBodyCache[num];
      if (err && err.code === 'permission-denied') return null;
      throw err;
    });
  return _chapterBodyCache[num];
}

// WHAT COUNTS AS A CHAPTER HAVING A VIDEO
//
// Until the recordings exist, a chapter has no video. The bundled seed used
// to point every chapter at a public sample clip (Big Buck Bunny) as a
// placeholder, and chapter documents already written to Firestore still
// carry that URL — so an empty field is not the only way a chapter can lack
// its own recording. Treating the sample as "no video" keeps a cartoon from
// loading where the lesson should be, which is worse than showing no player
// at all.
//
// Both the reader and the course list ask this question, so it lives here
// beside the data rather than being answered twice, slightly differently.
// Put a real URL in the chapter editor and the player comes back on its own.
const PLACEHOLDER_CHAPTER_VIDEO = /commondatastorage\.googleapis\.com\/gtv-videos-bucket/i;

function chapterVideoUrl(ch){
  const url = String((ch && ch.video) || '').trim();
  if (!url || PLACEHOLDER_CHAPTER_VIDEO.test(url)) return '';
  return url;
}
