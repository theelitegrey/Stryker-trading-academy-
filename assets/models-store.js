// Stryker Trading Academy — live Trading Models store
// Depends on: assets/progress.js (for `db`), and assets/models-data.js
// (for the MODELS_SEED fallback/import source) if that script is also
// loaded on the page.
//
// Mirrors assets/chapters-store.js exactly. All pages that display model
// content must call `await loadModels()` before reading the MODELS array.

let MODELS = [];
let _modelsLoadPromise = null;

function loadModels(forceRefresh){
  if (_modelsLoadPromise && !forceRefresh) return _modelsLoadPromise;

  if (!db) {
    MODELS = typeof MODELS_SEED !== 'undefined' ? MODELS_SEED : [];
    _modelsLoadPromise = Promise.resolve(MODELS);
    return _modelsLoadPromise;
  }

  _modelsLoadPromise = db.collection('models').get()
    .then((snap) => {
      const list = [];
      snap.forEach((doc) => list.push(doc.data()));
      list.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

      if (!list.length && typeof MODELS_SEED !== 'undefined' && MODELS_SEED.length) {
        MODELS = MODELS_SEED;
      } else {
        MODELS = list;
      }
      return MODELS;
    })
    .catch((err) => {
      console.error('Stryker: failed to load trading models from Firestore', err);
      if (typeof MODELS_SEED !== 'undefined') {
        MODELS = MODELS_SEED;
      }
      return MODELS;
    });

  return _modelsLoadPromise;
}
