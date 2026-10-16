// Real-users-unaffected check: (1) every path the seed writes is uid-scoped; (2) live data has no demo traces outside those
// paths; (3) the live paper leaderboards do not contain the demo uid.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import * as G from './lib/gcp.mjs';
const uid = Object.fromEntries(fs.readFileSync(process.env.DEMO_CREDENTIALS || '/root/.hermes/profiles/chief-of-staff/secure/demo-account/credentials','utf8').split('\n').filter(l=>l.includes('=')).map(l=>[l.slice(0,l.indexOf('=')),l.slice(l.indexOf('=')+1)])).uid;
const list = execFileSync('node', ['seed.mjs', '--dry-run', '--paths'], { encoding: 'utf8' }).trim().split('\n');
const ok = (p) => /^students\/\{uid\}(\/|$)/.test(p) || p === 'profiles/{uid}' || /^usernames\/richard_hale$/.test(p) || /^notifications\/\* \(recipientUid=\{uid\}\)$/.test(p);
const bad = list.filter((p) => !ok(p));
console.log('seed write paths:', list.length, 'outside uid scope:', bad.length, bad);
const stud = await G.listPaths('students'); console.log('students docs:', stud.length, '(76 real + 1 demo expected)');
const un = await G.getDoc('usernames/richard_hale'); console.log('username doc points at demo uid:', un && un.uid === uid);
const rows = await G.queryEq('notifications', 'recipientUid', uid); console.log('notifications addressed to demo uid:', rows.length);
for (const per of ['week', 'month', 'all']) {
  const d = await G.getDoc('leaderboards/paper-' + per);
  console.log('leaderboards/paper-' + per, d ? 'exists' : 'missing', 'contains demo uid:', d ? JSON.stringify(d).includes(uid) : false);
}
const pub = await G.getDoc(`students/${uid}/paperTrading/public`); console.log('paperTrading/public.optIn:', pub && pub.optIn);
