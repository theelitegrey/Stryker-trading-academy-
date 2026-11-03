// Deletes our own e2e probe accounts. Usage: node sweep-probes.js [--delete]
// Matches ONLY displayName "Probe Test" OR (email local part starts "tzmw" on a mail.tm domain). Dry-run by default.
const admin = require('firebase-admin');
const DELETE = process.argv.includes('--delete');
const sa = JSON.parse(process.env.FIREBASE_SA_KEY);
admin.initializeApp({ credential: admin.credential.cert(sa) });
const MAILTM = new Set(['fldubai.com']); // + domains read live below
const isProbe = (u) => {
  const e = (u.email || '').toLowerCase(), [loc, dom] = e.split('@');
  return u.displayName === 'Probe Test' || (!!loc && loc.startsWith('tzmw') && MAILTM.has(dom));
};
(async () => {
  try { const r = await fetch('https://api.mail.tm/domains'); for (const d of (await r.json())['hydra:member']) MAILTM.add(d.domain); } catch (e) { console.log('mail.tm domain list unavailable; using known domains'); }
  const hits = []; let tok;
  do { const r = await admin.auth().listUsers(1000, tok); r.users.forEach((u) => isProbe(u) && hits.push(u)); tok = r.pageToken; } while (tok);
  console.log('auth matched', hits.length); hits.forEach((u) => console.log(' ', u.email));
  // Orphans: probes deleted their login but left students/{uid}.
  const db = admin.firestore(); const seen = new Set(hits.map((u) => u.uid)); const orphans = [];
  for (const d of (await db.collection('students').select('displayName', 'email').get()).docs) {
    if (!seen.has(d.id) && isProbe(d.data())) orphans.push(d.id);
  }
  console.log('orphan student docs matched', orphans.length);
  const all = await db.collection('students').select('email', 'displayName').get();
  all.docs.filter((d) => orphans.includes(d.id)).forEach((d) => console.log(' ', d.data().email));
  if (!DELETE) return console.log('dry run, nothing deleted');
  let n = 0;
  for (const u of hits) {
    const ref = db.collection('students').doc(u.uid);
    await db.recursiveDelete(ref);
    await db.collection('profiles').doc(u.uid).delete();
    await admin.auth().deleteUser(u.uid); n++;
  }
  for (const id of orphans) { await db.recursiveDelete(db.collection('students').doc(id)); await db.collection('profiles').doc(id).delete(); n++; }
  console.log('deleted', n);
})().catch((e) => { console.error('ERR', e.code, String(e.message).slice(0, 300)); process.exit(1); });
