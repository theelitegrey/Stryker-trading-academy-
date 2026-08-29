// Stryker Trading Academy — @usernames
// Depends on: assets/progress.js (`db`, `auth`)
//
// Every student gets a handle: shown on their profile, editable in Settings,
// and taggable on the Trading Floor. The handle defaults to the local part of
// their email (gauravsinghpost@gmail.com -> @gauravsinghpost) the first time
// any page runs ensureUsername for them, so existing accounts self-heal the
// next visit without a migration.
//
// UNIQUENESS lives in its own collection, usernames/{name} -> { uid }, because
// Firestore cannot enforce "no two profiles share this field" any other way:
// the name IS the document id, so two people claiming @alex is two writes to
// the same doc, and the transaction below makes the second one lose. Needs
// this security rule:
//
//   match /usernames/{name} {
//     allow read: if request.auth != null;
//     allow create: if request.auth != null && request.resource.data.uid == request.auth.uid;
//     allow delete: if request.auth != null && resource.data.uid == request.auth.uid;
//   }

var USERNAME_MIN = 3, USERNAME_MAX = 20;

// Lowercase letters, digits and underscore — the same alphabet the floor's
// mention regex matches, so every legal handle is also a taggable one.
function normalizeUsername(raw){
  return String(raw || '').toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, USERNAME_MAX);
}

function usernameError(name){
  if (!name || name.length < USERNAME_MIN) return 'At least ' + USERNAME_MIN + ' characters — letters, numbers and _ only.';
  if (!/^[a-z0-9_]+$/.test(name)) return 'Letters, numbers and _ only.';
  if (/^_+$/.test(name)) return 'Needs at least one letter or number.';
  return null;
}

function usernameFromEmail(email){
  return normalizeUsername(String(email || '').split('@')[0]);
}

// name -> uid, or null. The resolver behind profile.html?u= and floor tags.
function lookupUsername(name){
  var n = normalizeUsername(name);
  if (!n || typeof db === 'undefined' || !db) return Promise.resolve(null);
  return db.collection('usernames').doc(n).get()
    .then(function (d) { return d.exists ? d.data().uid : null; })
    .catch(function () { return null; });
}

// Claim `name` for `uid`, releasing `oldName` if it was theirs. The
// transaction is what makes a simultaneous claim of the same handle safe:
// both read, one commits, the other aborts with 'taken'.
function claimUsername(uid, name, oldName){
  var n = normalizeUsername(name);
  var bad = usernameError(n);
  if (bad) return Promise.resolve({ ok: false, error: bad });

  var ref = db.collection('usernames').doc(n);
  return db.runTransaction(function (tx) {
    return tx.get(ref).then(function (doc) {
      if (doc.exists && doc.data().uid !== uid) throw new Error('taken');
      tx.set(ref, { uid: uid, username: n });
    });
  }).then(function () {
    var old = normalizeUsername(oldName);
    var release = (old && old !== n)
      ? db.collection('usernames').doc(old).delete().catch(function () {})
      : Promise.resolve();
    return Promise.all([
      release,
      db.collection('profiles').doc(uid).set({ username: n }, { merge: true }),
      db.collection('students').doc(uid).set({ username: n }, { merge: true })
    ]).then(function () { return { ok: true, username: n }; });
  }).catch(function (err) {
    if (String(err && err.message).indexOf('taken') !== -1) {
      return { ok: false, error: '@' + n + ' is already taken.' };
    }
    console.error('Stryker: username claim failed', err);
    return { ok: false, error: 'Could not save the username. Try again.' };
  });
}

// First-visit default: derive from the email, walk 2, 3, 4… on collision.
// Runs quietly on every page this file is loaded on; a profile that already
// has a username costs one read and stops there.
function ensureUsername(user){
  if (!user || typeof db === 'undefined' || !db) return Promise.resolve(null);
  return db.collection('profiles').doc(user.uid).get().then(function (doc) {
    var existing = doc.exists && doc.data().username;
    if (existing) return existing;

    var base = usernameFromEmail(user.email) ||
               normalizeUsername(user.displayName) ||
               ('trader' + user.uid.slice(0, 6).toLowerCase());
    if (base.length < USERNAME_MIN) base = (base + '___').slice(0, USERNAME_MIN);

    function attempt(candidate, n){
      if (n > 30) return null;
      return claimUsername(user.uid, candidate, null).then(function (res) {
        if (res.ok) return res.username;
        if (res.error && res.error.indexOf('taken') !== -1) {
          return attempt(base.slice(0, USERNAME_MAX - String(n).length) + n, n + 1);
        }
        return null;
      });
    }
    return attempt(base, 2);
  }).catch(function () { return null; });
}

document.addEventListener('DOMContentLoaded', function () {
  if (typeof auth === 'undefined' || !auth) return;
  var done = false;
  auth.onAuthStateChanged(function (user) {
    if (done || !user) return;
    done = true;
    ensureUsername(user);
  });
});
