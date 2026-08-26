// Stryker Trading Academy — online presence
// Depends on: assets/auth.js (auth), assets/progress.js (db)
//
// presence/{uid}: { lastSeen, name }
//
// HIDDEN MEANS NO DOCUMENT, NOT A FLAG.
// The obvious design is presence/{uid}.visible = false and readers skipping
// it. That is not privacy — the document still says exactly when someone was
// last active, and anyone able to read the collection can see it whatever the
// flag says. Hiding is enforced by simply not writing, and by deleting any
// existing document. There is then nothing to leak.
//
// HEARTBEAT, NOT A DISCONNECT HOOK.
// Firestore has no onDisconnect (that is Realtime Database). A browser closed
// abruptly never gets to mark itself offline, so "online" cannot mean a stored
// flag — it means a timestamp written recently. A stale one simply ages out,
// which also handles crashes, lost connections and killed tabs identically.
//
// Only beats while the tab is VISIBLE. A backgrounded tab writing every minute
// forever would spend quota describing someone who isn't there.

var PRESENCE_BEAT_MS = 60000;      // write at most once a minute
var PRESENCE_ONLINE_MS = 150000;   // seen within 2.5 min counts as online
var PRESENCE_TIMER = null;
var PRESENCE_VISIBLE = true;       // this user's own privacy preference

function presenceIsOnline(doc){
  if (!doc) return false;
  var ts = doc.lastSeen;
  if (!ts || !ts.toMillis) return false;
  // Generous relative to the beat interval: a single missed write on a bad
  // connection shouldn't flicker someone offline mid-conversation.
  return (Date.now() - ts.toMillis()) < PRESENCE_ONLINE_MS;
}

function writePresence(){
  if (!PRESENCE_VISIBLE) return Promise.resolve();
  if (typeof auth === 'undefined' || !auth || !auth.currentUser) return Promise.resolve();
  var u = auth.currentUser;
  return db.collection('presence').doc(u.uid).set({
    lastSeen: firebase.firestore.FieldValue.serverTimestamp(),
    name: u.displayName || (u.email ? u.email.split('@')[0] : 'Trader')
  }).catch(function (err) {
    console.warn('Stryker: presence write failed', err);
  });
}

function clearPresence(){
  if (typeof auth === 'undefined' || !auth || !auth.currentUser) return Promise.resolve();
  return db.collection('presence').doc(auth.currentUser.uid).delete()
    .catch(function () { /* already gone, or rules changed — nothing to do */ });
}

function startPresence(){
  stopPresence();
  if (!PRESENCE_VISIBLE) return;
  writePresence();
  PRESENCE_TIMER = setInterval(function () {
    if (document.visibilityState === 'visible') writePresence();
  }, PRESENCE_BEAT_MS);
}

function stopPresence(){
  if (PRESENCE_TIMER) { clearInterval(PRESENCE_TIMER); PRESENCE_TIMER = null; }
}

// Called from Settings. Turning it off deletes the document immediately rather
// than waiting for it to age out — someone switching to hidden means now.
function setPresenceVisible(on){
  PRESENCE_VISIBLE = !!on;
  if (typeof auth === 'undefined' || !auth || !auth.currentUser) return Promise.resolve();

  return db.collection('students').doc(auth.currentUser.uid)
    .set({ presenceVisible: PRESENCE_VISIBLE }, { merge: true })
    .then(function () {
      if (PRESENCE_VISIBLE) { startPresence(); return; }
      stopPresence();
      return clearPresence();
    });
}

document.addEventListener('DOMContentLoaded', function () {
  if (typeof auth === 'undefined' || !auth) return;

  var started = false;
  auth.onAuthStateChanged(function (user) {
    if (started || !user) return;
    started = true;

    db.collection('students').doc(user.uid).get()
      .then(function (doc) {
        // Defaults to visible when unset. Presence is the useful behaviour and
        // the whole feature is pointless if nobody appears online by default;
        // anyone who wants out has a one-tap switch in Settings.
        var d = doc.exists ? doc.data() : {};
        PRESENCE_VISIBLE = d.presenceVisible !== false;
        startPresence();
      })
      .catch(function () { startPresence(); });
  });

  // Beat immediately on returning to the tab rather than waiting up to a
  // minute, so someone coming back appears online at once.
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') writePresence();
  });
});

// Best-effort: often does not complete on a hard close, which is exactly why
// the timestamp ages out on its own.
window.addEventListener('beforeunload', function () {
  stopPresence();
});

// ---- Settings panel wiring ------------------------------------------------
document.addEventListener('DOMContentLoaded', function () {
  var visRadio = document.getElementById('presence-visible');
  var hidRadio = document.getElementById('presence-hidden');
  if (!visRadio || !hidRadio) return;   // not on the settings page

  function apply(on){
    setPresenceVisible(on).then(function () {
      if (typeof showToast === 'function') {
        showToast('success', on
          ? "You'll appear online to other traders."
          : "You're hidden — nobody can see when you're active.");
      }
    }).catch(function (err) {
      if (typeof showToast === 'function') showToast('error', 'Could not save: ' + (err.message || err));
    });
  }

  visRadio.addEventListener('change', function () { if (visRadio.checked) apply(true); });
  hidRadio.addEventListener('change', function () { if (hidRadio.checked) apply(false); });

  if (typeof auth !== 'undefined' && auth) {
    var done = false;
    auth.onAuthStateChanged(function (user) {
      if (done || !user) return;
      done = true;
      db.collection('students').doc(user.uid).get().then(function (doc) {
        var on = !doc.exists || doc.data().presenceVisible !== false;
        visRadio.checked = on;
        hidRadio.checked = !on;
      });
    });
  }
});
