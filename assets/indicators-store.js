// Stryker Trading Academy — live Trading Indicators store
// Depends on: assets/progress.js (for `db`)
// Mirrors assets/models-store.js, with no seed fallback — this collection
// starts empty and is filled in entirely through the admin editor.

let INDICATORS = [];
let _indicatorsLoadPromise = null;

function loadIndicators(forceRefresh){
  if (_indicatorsLoadPromise && !forceRefresh) return _indicatorsLoadPromise;

  if (typeof db === 'undefined' || !db) {
    INDICATORS = [];
    _indicatorsLoadPromise = Promise.resolve(INDICATORS);
    return _indicatorsLoadPromise;
  }

  _indicatorsLoadPromise = db.collection('indicators').get()
    .then((snap) => {
      const list = [];
      snap.forEach((doc) => list.push(doc.data()));
      list.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
      INDICATORS = list;
      return INDICATORS;
    })
    .catch((err) => {
      console.error('Stryker: failed to load trading indicators from Firestore', err);
      return INDICATORS;
    });

  return _indicatorsLoadPromise;
}
