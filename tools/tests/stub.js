// The Firebase stub, as a real interpolated string.
//
// Previously each suite re-read another suite's SOURCE and regex'd the stub
// out of it. That extracts the template literal's raw text — `(${function
// () {...}})()` — with the substitution never performed, so the init script
// was invalid JS, silently failed to run, and the page booted with no
// firebase at all. Tests still "passed" because most assertions do not need
// it. Export the built string once instead.
function build() {
  const body = function () {
    const snap = (d) => ({ exists: !!d, data: () => d || {} });
    const docRef = () => ({
      get: () => Promise.resolve(snap(null)),
      set: () => Promise.resolve(),
      update: () => Promise.resolve(),
      collection: () => colRef()
    });
    const colRef = () => ({
      doc: docRef,
      get: () => Promise.resolve({ empty: true, size: 0, docs: [], forEach: () => {} }),
      add: () => Promise.resolve({ id: 'x' }),
      where: () => colRef(), orderBy: () => colRef(), limit: () => colRef(),
      onSnapshot: () => () => {}
    });
    window.__stubDb = { collection: colRef, batch: () => ({ set(){}, update(){}, delete(){}, commit: () => Promise.resolve() }) };
    window.db = window.__stubDb;
    window.__stubAuth = {
      currentUser: { uid: 'u1', email: 't@e.com' },
      onAuthStateChanged: (cb) => setTimeout(() => cb({ uid: 'u1', email: 't@e.com' }), 10),
      setPersistence: () => Promise.resolve(),
      signOut: () => Promise.resolve()
    };
    window.firebase = {
      apps: [],
      initializeApp: () => ({}),
      app: () => ({ functions: () => ({ httpsCallable: () => () => Promise.resolve({ data: {} }) }) }),
      firestore: Object.assign(() => window.__stubDb, {
        FieldValue: {
          serverTimestamp: () => 'TS', increment: (n) => ({ inc: n }),
          delete: () => 'DEL', arrayUnion: () => 'AU', arrayRemove: () => 'AR'
        },
        Timestamp: { now: () => ({ toDate: () => new Date() }) }
      }),
      auth: Object.assign(() => window.__stubAuth, { Auth: { Persistence: { LOCAL: 'l', SESSION: 's' } } }),
      messaging: () => ({ getToken: () => Promise.resolve(null), onMessage: () => {} })
    };
    window.auth = window.__stubAuth;
    window.showToast = () => Promise.resolve();
  };
  return '(' + body.toString() + ')()';
}
module.exports = build();
