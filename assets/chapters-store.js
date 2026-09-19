// Stryker Trading Academy — live chapters store
// Depends on: assets/progress.js (for `db`), and assets/chapters-data.js
// (for the CHAPTERS_SEED fallback/import source) if that script is also
// loaded on the page.
//
// All pages that display chapter content must call `await loadChapters()`
// before reading the CHAPTERS array — unlike the old static file, this is
// no longer synchronously available at parse time.

let CHAPTERS = [];
let _chaptersLoadPromise = null;

function loadChapters(forceRefresh){
  if (_chaptersLoadPromise && !forceRefresh) return _chaptersLoadPromise;

  if (!db) {
    // Firestore never initialized — fall back to bundled content instead of
    // leaving the page stuck on "Loading chapter…" forever.
    CHAPTERS = typeof CHAPTERS_SEED !== 'undefined' ? CHAPTERS_SEED : [];
    _chaptersLoadPromise = Promise.resolve(CHAPTERS);
    return _chaptersLoadPromise;
  }

  _chaptersLoadPromise = db.collection('chapters').get()
    .then((snap) => {
      const list = [];
      snap.forEach((doc) => list.push(doc.data()));
      list.sort((a, b) => a.num.localeCompare(b.num));

      if (!list.length && typeof CHAPTERS_SEED !== 'undefined') {
        // Firestore hasn't been seeded yet — fall back to the bundled data
        // so the site still works, rather than showing an empty curriculum.
        CHAPTERS = CHAPTERS_SEED;
      } else {
        CHAPTERS = list;
      }
      return CHAPTERS;
    })
    .catch((err) => {
      console.error('Stryker: failed to load chapters from Firestore', err);
      if (typeof CHAPTERS_SEED !== 'undefined') {
        CHAPTERS = CHAPTERS_SEED;
      }
      return CHAPTERS;
    });

  return _chaptersLoadPromise;
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
