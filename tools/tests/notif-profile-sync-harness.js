// Harness for w1-notif-profile-sync: simulates the two call shapes of
// checkAndNotifyNewAchievementsFor(uid, isSelf) against a Firestore stub
// that enforces the SAME rules as functions-src/firestore.rules for
// students/{uid} (read: isSelf(uid) || isAdmin()) and profiles/{uid}
// (update: isAdmin() || (isSelf(uid) && !touchesPrivileged())), for a
// regular (non-admin) authenticated user. No real Firestore involved.
const vm = require('vm');
const fs = require('fs');
const path = require('path');

const CALLER_UID = 'liker-1';
const OTHER_UID = 'author-2';

function mkStub(){
  const calls = { studentReads: [], profileWrites: [] };
  const denied = () => { const e = new Error('Missing or insufficient permissions.'); e.code = 'permission-denied'; return e; };
  const studentDoc = { floorPostCount: 3, floorReplyCount: 1, floorLikesReceived: 5, journalEntryCount: 0, hasWinningTrade: false, referralPoints: 0, tradingViewAccessGranted: false };
  const db = {
    collection(coll) {
      return {
        doc(uid) {
          return {
            get() {
              if (coll === 'students') {
                calls.studentReads.push(uid);
                // firestore.rules: allow read: if isSelf(uid) || isAdmin();
                // CALLER_UID is never an admin here.
                if (uid !== CALLER_UID) return Promise.reject(denied());
                return Promise.resolve({ exists: true, data: () => studentDoc });
              }
              return Promise.resolve({ exists: false, data: () => ({}) });
            },
            set(fields) {
              if (coll === 'profiles') {
                calls.profileWrites.push({ uid, fields });
                // firestore.rules: allow update: if isAdmin() || (isSelf(uid) && !touchesPrivileged());
                if (uid !== CALLER_UID) return Promise.reject(denied());
                return Promise.resolve();
              }
              return Promise.resolve();
            }
          };
        }
      };
    }
  };
  return { db, calls };
}

function loadSandbox(dbStub){
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'assets', 'notifications.js'), 'utf8');
  const sandbox = {
    db: dbStub,
    auth: { currentUser: { uid: CALLER_UID, getIdToken: () => Promise.resolve('t') } },
    syncPublicProfile(uid, fields){ return dbStub.collection('profiles').doc(uid).set(fields, { merge: true }); },
    checkAndNotifyNewAchievements(){ return Promise.resolve(); },
    document: { addEventListener(){} },
    window: {},
    console
  };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: 'notifications.js' });
  return sandbox;
}

async function main(){
  let failed = false;
  const ok = (label, cond, extra) => {
    console.log((cond ? 'PASS  ' : 'FAIL  ') + label + (extra !== undefined ? '   ' + extra : ''));
    if (!cond) failed = true;
  };

  // 1. Cross-user call (isSelf: false), e.g. community.js liking someone
  // else's post: checkAndNotifyNewAchievementsFor(post.authorUid, false).
  {
    const { db, calls } = mkStub();
    const sandbox = loadSandbox(db);
    await sandbox.checkAndNotifyNewAchievementsFor(OTHER_UID, false);
    ok('cross-user (isSelf:false): 0 profile writes attempted', calls.profileWrites.length === 0, calls.profileWrites.length);
    ok('cross-user (isSelf:false): student doc still read (for the achievement check)', calls.studentReads.length === 1 && calls.studentReads[0] === OTHER_UID);
  }

  // 2. Self call (isSelf: true), e.g. community.js after your own post:
  // checkAndNotifyNewAchievementsFor(FLOOR_UID, true).
  {
    const { db, calls } = mkStub();
    const sandbox = loadSandbox(db);
    await sandbox.checkAndNotifyNewAchievementsFor(CALLER_UID, true);
    ok('self (isSelf:true): exactly 1 profile write, to own uid', calls.profileWrites.length === 1 && calls.profileWrites[0].uid === CALLER_UID);
    const fields = calls.profileWrites[0].fields;
    ok('self (isSelf:true): write carries all 5 fields, unchanged shape',
      'floorPostCount' in fields && 'floorReplyCount' in fields && 'floorLikesReceived' in fields
      && 'referralPoints' in fields && 'tradingViewAccessGranted' in fields);
  }

  console.log(failed ? '\nFAIL' : '\nALL PASS');
  process.exit(failed ? 1 : 0);
}

main();
