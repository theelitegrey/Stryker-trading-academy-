// Stryker Trading Academy — Firestore-backed student progress
// Requires firebase-app-compat.js, firebase-auth-compat.js, firebase-firestore-compat.js,
// and assets/auth.js (initializes the Firebase app + `auth`) to be loaded first.

// Guarded the same way `auth` is in auth.js: if Firebase failed to
// initialize upstream, calling firebase.firestore() here would throw
// synchronously and silently kill every script that loads after this one
// (chapters-store.js, reader.js, dashboard.js, etc. all depend on `db`).
let db = null;
try {
  db = firebase.firestore();
} catch (err) {
  console.error('Stryker: Firestore failed to initialize', err);
}

function todayStr(){
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function daysBetween(a, b){
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.round((new Date(b) - new Date(a)) / msPerDay);
}

// Creates the student's Firestore doc on first sign-in, and advances their
// study streak at most once per calendar day. Safe to call on every page load
// — it's a no-op write if nothing has changed since today.
function ensureStudentDoc(user){
  if (!user) return Promise.resolve(null);
  const ref = db.collection('students').doc(user.uid);
  return ref.get().then((snap) => {
    const today = todayStr();

    if (!snap.exists) {
      let referralPark = Promise.resolve();
      const data = {
        displayName: user.displayName || '',
        email: user.email || '',
        photoURL: user.photoURL || null,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        lastActiveDate: today,
        currentStreak: 1,
        bestStreak: 1,
        completedLessons: [],
        completedChapters: []
      };
      return ref.set(data).then(() => {
        // Non-blocking: resolve any pending ?ref= invite code from signup.
        // A failure here should never prevent the student doc itself from
        // being created, so it's intentionally not chained into the return.
        // Parking the code is now awaited (see referralPark below) rather than
        // fired and forgotten, so the deferred completion step at the end of
        // this branch can act on it in the same page load. For a Google
        // signup, which is verified from the very first moment, that means the
        // referrer is credited immediately instead of one navigation later.
        referralPark = (typeof processPendingReferralForNewStudent === 'function')
          ? processPendingReferralForNewStudent(user.uid, data.displayName, data.email)
          : Promise.resolve();
        // Non-blocking: bump the public "traders enrolled" counter shown on
        // the homepage. This is a separate count-only doc, not a query
        // against the students collection itself — see main.js for why.
        db.collection('publicStats').doc('enrollment')
          .set({ count: firebase.firestore.FieldValue.increment(1) }, { merge: true })
          .catch((err) => console.error('Stryker: failed to update enrolled count', err));
        // Non-blocking: seed this student's public profile doc (see
        // assets/profiles-sync.js for why this is a separate collection).
        if (typeof syncPublicProfile === 'function') {
          syncPublicProfile(user.uid, {
            displayName: data.displayName,
            photoURL: data.photoURL,
            createdAt: data.createdAt,
            currentStreak: data.currentStreak,
            bestStreak: data.bestStreak
          });
        }
      }).then(() => referralPark).then(() => ref.get()).then(s => {
        const student = Object.assign({ uid: user.uid }, s.data());
        if (typeof processPendingReferralIfReady === 'function') {
          processPendingReferralIfReady(user.uid, student);
        }
        return student;
      });
    }

    const data = snap.data();
    const updates = {
      displayName: user.displayName || data.displayName || '',
      email: user.email || data.email || ''
    };
    // Refresh the Google photo if one is newly available and no custom
    // upload is set — a custom upload always wins and is never overwritten.
    if (user.photoURL && !data.customPhotoURL && user.photoURL !== data.photoURL) {
      updates.photoURL = user.photoURL;
    }

    if (data.lastActiveDate !== today) {
      const gap = daysBetween(data.lastActiveDate, today);
      const newStreak = (gap === 1) ? (data.currentStreak || 0) + 1 : 1;
      updates.currentStreak = newStreak;
      updates.bestStreak = Math.max(newStreak, data.bestStreak || 0);
      updates.lastActiveDate = today;
    }

    return ref.set(updates, { merge: true }).then(() => {
      // Non-blocking: keep the public profile's copy of these specific
      // fields current. Deliberately excludes `email` (never public) and
      // doesn't touch avatarSeed/customPhotoURL/plan — those are synced by
      // whichever file actually owns that change (settings.js, students-admin.js).
      if (typeof syncPublicProfile === 'function') {
        const profileUpdate = { displayName: updates.displayName };
        if (updates.photoURL) profileUpdate.photoURL = updates.photoURL;
        if (updates.currentStreak !== undefined) profileUpdate.currentStreak = updates.currentStreak;
        if (updates.bestStreak !== undefined) profileUpdate.bestStreak = updates.bestStreak;
        syncPublicProfile(user.uid, profileUpdate);
      }
    }).then(() => ref.get()).then(s => {
      const student = Object.assign({ uid: user.uid }, s.data());
      // Non-blocking: finish any referral that was parked at signup but
      // couldn't be written until the account was email-verified. Runs on
      // every load and bails immediately when there's nothing parked.
      if (typeof processPendingReferralIfReady === 'function') {
        processPendingReferralIfReady(user.uid, student);
      }
      return student;
    });
  });
}

function getStudentDoc(uid){
  return db.collection('students').doc(uid).get()
    .then(snap => snap.exists ? Object.assign({ uid }, snap.data()) : null);
}

function saveStudentProgress(uid, completedLessonsSet, completedChaptersSet){
  // Non-blocking: keep the public profile's chapter/lesson COUNTS current —
  // not the actual lists, which stay private. A count is enough to compute
  // most achievement badges (first chapter, curriculum complete, lesson
  // milestones) without revealing exactly which chapters someone's done.
  if (typeof syncPublicProfile === 'function') {
    syncPublicProfile(uid, {
      completedChaptersCount: completedChaptersSet.size,
      completedLessonsCount: completedLessonsSet.size
    });
  }
  return db.collection('students').doc(uid).set({
    completedLessons: Array.from(completedLessonsSet),
    completedChapters: Array.from(completedChaptersSet)
  }, { merge: true });
}
