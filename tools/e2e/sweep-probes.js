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
  console.log('matched', hits.length); hits.forEach((u) => console.log(' ', u.email));
  if (!DELETE) return console.log('dry run, nothing deleted');
  const db = admin.firestore(); let n = 0;
  for (const u of hits) {
    const ref = db.collection('students').doc(u.uid);
    await db.recursiveDelete(ref);
    await db.collection('profiles').doc(u.uid).delete();
    await admin.auth().deleteUser(u.uid); n++;
  }
  console.log('deleted', n);
})().catch((e) => { console.error('ERR', e.code || e.message); process.exit(1); });
