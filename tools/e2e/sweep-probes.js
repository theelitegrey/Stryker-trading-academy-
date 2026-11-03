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
  // Firestore via REST with the CI user's token (the service account has no Firestore role).
  const fs = require('fs'), cp = require('child_process');
  const T = fs.readFileSync('/tmp/fbtok', 'utf8').trim(), P = 'strykertrades-e0cd8';
  const base = `https://firestore.googleapis.com/v1/projects/${P}/databases/(default)/documents`;
  const H = { authorization: 'Bearer ' + T };
  const docs = []; let pt = '';
  do {
    const r = await (await fetch(`${base}/students?pageSize=300&mask.fieldPaths=displayName&mask.fieldPaths=email${pt}`, { headers: H })).json();
    if (r.error) throw new Error('list ' + r.error.message);
    (r.documents || []).forEach((d) => docs.push({ id: d.name.split('/').pop(), displayName: (d.fields.displayName || {}).stringValue, email: (d.fields.email || {}).stringValue }));
    pt = r.nextPageToken ? '&pageToken=' + encodeURIComponent(r.nextPageToken) : '';
  } while (pt);
  console.log('students scanned', docs.length);
  const seen = new Set(hits.map((u) => u.uid));
  const orphans = docs.filter((d) => !seen.has(d.id) && isProbe(d)).map((d) => d.id);
  docs.filter((d) => orphans.includes(d.id)).forEach((d) => console.log('  orphan', d.email));
  console.log('orphan student docs matched', orphans.length);
  if (!DELETE) return console.log('dry run, nothing deleted');
  let n = 0;
  const wipe = (uid) => {
    cp.execFileSync('npx', ['--yes', 'firebase-tools@13', 'firestore:delete', 'students/' + uid, '-r', '-f', '--project', P, '--token', process.env.FIREBASE_CI_TOKEN], { stdio: 'ignore' });
    return fetch(`${base}/profiles/${uid}`, { method: 'DELETE', headers: H });
  };
  const ids = new Set([...hits.map((u) => u.uid), ...orphans]);
  for (const uid of ids) { await wipe(uid); if (seen.has(uid)) await admin.auth().deleteUser(uid); n++; }
  console.log('deleted', n);
})().catch((e) => { console.error('ERR', e.code, String(e.message).slice(0, 300)); process.exit(1); });
