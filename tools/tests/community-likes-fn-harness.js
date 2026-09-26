// Harness for w1-likes-fn-draft: exercises functions-src/communityLikes.js
// with a stubbed firebase-functions/v2/firestore + firebase-admin, so the
// trigger's before/after diff and increment logic can be checked without
// installing dependencies or touching real Firestore.
//
// Cases: like, unlike, self-like (no-op), unrelated write (likedBy
// unchanged -> no-op), multiple likes landing in one write (batched delta).
const Module = require('module');
const path = require('path');

const FN_DIR = path.join(__dirname, '..', '..', 'functions-src');
const FN_FILE = path.join(FN_DIR, 'communityLikes.js');

// --- stub firebase-admin -----------------------------------------------
const writes = []; // { coll, uid, fields }
function mkDocRef(coll, uid, studentExists) {
  return {
    get: () => Promise.resolve({ exists: coll === 'students' ? studentExists(uid) : true }),
    set: (fields, opts) => { writes.push({ coll, uid, fields, opts }); return Promise.resolve(); }
  };
}
function mkAdminStub(studentExists) {
  let handler = null;
  const firestoreFn = () => ({
    collection: (coll) => ({ doc: (uid) => mkDocRef(coll, uid, studentExists) })
  });
  firestoreFn.FieldValue = { increment: (n) => ({ __increment: n }) };
  return { apps: [], initializeApp: () => {}, firestore: firestoreFn };
}

// --- stub firebase-functions/v2/firestore -------------------------------
function mkFunctionsStub(captureHandler) {
  return {
    onDocumentWritten: (opts, handler) => { captureHandler(handler); return { __opts: opts, __handler: handler }; }
  };
}

function loadModule(adminStub, functionsStub) {
  const origLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (request === 'firebase-admin') return adminStub;
    if (request === 'firebase-functions/v2/firestore') return functionsStub;
    return origLoad.apply(this, arguments);
  };
  delete require.cache[require.resolve(FN_FILE)];
  let mod;
  try {
    mod = require(FN_FILE);
  } finally {
    Module._load = origLoad;
  }
  return mod;
}

function snap(exists, data) {
  return { exists, data: () => data };
}

async function run(label, { before, after, authorUid, authorIsStudent = true, extraChecks }) {
  writes.length = 0;
  let handler;
  const adminStub = mkAdminStub(() => authorIsStudent);
  const functionsStub = mkFunctionsStub((h) => { handler = h; });
  loadModule(adminStub, functionsStub);

  const beforeSnap = before === undefined ? { exists: false } : snap(true, before);
  const afterSnap = after === undefined ? { exists: false } : snap(true, after);

  await handler({
    params: { postId: 'p1' },
    data: { before: beforeSnap, after: afterSnap }
  });

  console.log('--- ' + label + ' ---');
  console.log('  writes:', JSON.stringify(writes));
  if (extraChecks) extraChecks(writes);
}

async function main() {
  const authorUid = 'author-1';

  await run('like: 0 -> 1 liker', {
    before: { authorUid, likedBy: [] },
    after: { authorUid, likedBy: ['liker-1'] },
    extraChecks: (w) => assert(w.length === 2
      && w[0].coll === 'students' && w[0].fields.floorLikesReceived.__increment === 1
      && w[1].coll === 'profiles' && w[1].fields.floorLikesReceived.__increment === 1,
      'like should produce exactly +1 to students and profiles')
  });

  await run('unlike: 1 -> 0 likers', {
    before: { authorUid, likedBy: ['liker-1'] },
    after: { authorUid, likedBy: [] },
    extraChecks: (w) => assert(w.length === 2 && w[0].fields.floorLikesReceived.__increment === -1,
      'unlike should produce exactly -1')
  });

  await run('self-like: author likes own post (no-op)', {
    before: { authorUid, likedBy: [] },
    after: { authorUid, likedBy: [authorUid] },
    extraChecks: (w) => assert(w.length === 0, 'self-like must not write anything')
  });

  await run('self-unlike: author removes own like (no-op)', {
    before: { authorUid, likedBy: [authorUid] },
    after: { authorUid, likedBy: [] },
    extraChecks: (w) => assert(w.length === 0, 'self-unlike must not write anything')
  });

  await run('unchanged likedBy (e.g. text edit touched the doc)', {
    before: { authorUid, likedBy: ['liker-1'], textHtml: 'old' },
    after: { authorUid, likedBy: ['liker-1'], textHtml: 'new' },
    extraChecks: (w) => assert(w.length === 0, 'unrelated field change must not write anything')
  });

  await run('multiple likes landing in one write: 0 -> 3 likers', {
    before: { authorUid, likedBy: [] },
    after: { authorUid, likedBy: ['liker-1', 'liker-2', 'liker-3'] },
    extraChecks: (w) => assert(w.length === 2 && w[0].fields.floorLikesReceived.__increment === 3,
      'batched +3 like delta')
  });

  await run('mixed batch: 2 added, 1 removed in one write (net +1)', {
    before: { authorUid, likedBy: ['liker-1', 'liker-2'] },
    after: { authorUid, likedBy: ['liker-2', 'liker-3', 'liker-4'] },
    extraChecks: (w) => assert(w.length === 2 && w[0].fields.floorLikesReceived.__increment === 1,
      'net delta should be +1 (liker-1 left, liker-3+liker-4 joined)')
  });

  await run('author not a student (deleted account): skip write', {
    before: { authorUid, likedBy: [] },
    after: { authorUid, likedBy: ['liker-1'] },
    authorIsStudent: false,
    extraChecks: (w) => assert(w.length === 0, 'missing student doc must not write')
  });

  await run('post created (before missing/deleted) with a self+other like', {
    before: undefined,
    after: { authorUid, likedBy: [authorUid, 'liker-1'] },
    extraChecks: (w) => assert(w.length === 2 && w[0].fields.floorLikesReceived.__increment === 1,
      'new post created with the author pre-liking + one real liker -> +1, self excluded')
  });

  console.log('\nALL PASS');
}

let failed = false;
function assert(cond, msg) {
  if (!cond) { failed = true; console.log('  FAIL: ' + msg); }
  else console.log('  PASS: ' + msg);
}

main().then(() => process.exit(failed ? 1 : 0)).catch((e) => { console.error(e); process.exit(1); });
