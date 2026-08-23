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
