// Stryker Trading Academy — Firestore-backed student progress
// Requires firebase-app-compat.js, firebase-auth-compat.js, firebase-firestore-compat.js,
// and assets/auth.js (initializes the Firebase app + `auth`) to be loaded first.

const db = firebase.firestore();

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
      const data = {
        displayName: user.displayName || '',
        email: user.email || '',
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        lastActiveDate: today,
        currentStreak: 1,
        bestStreak: 1,
        completedLessons: [],
        completedChapters: []
      };
      return ref.set(data).then(() => ref.get()).then(s => Object.assign({ uid: user.uid }, s.data()));
    }

    const data = snap.data();
    const updates = {
      displayName: user.displayName || data.displayName || '',
      email: user.email || data.email || ''
    };

    if (data.lastActiveDate !== today) {
      const gap = daysBetween(data.lastActiveDate, today);
      const newStreak = (gap === 1) ? (data.currentStreak || 0) + 1 : 1;
      updates.currentStreak = newStreak;
      updates.bestStreak = Math.max(newStreak, data.bestStreak || 0);
      updates.lastActiveDate = today;
    }

    return ref.set(updates, { merge: true }).then(() => ref.get()).then(s => Object.assign({ uid: user.uid }, s.data()));
  });
}

function getStudentDoc(uid){
  return db.collection('students').doc(uid).get()
    .then(snap => snap.exists ? Object.assign({ uid }, snap.data()) : null);
}

function saveStudentProgress(uid, completedLessonsSet, completedChaptersSet){
  return db.collection('students').doc(uid).set({
    completedLessons: Array.from(completedLessonsSet),
    completedChapters: Array.from(completedChaptersSet)
  }, { merge: true });
}
