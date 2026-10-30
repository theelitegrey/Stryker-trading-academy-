#!/usr/bin/env node
// Creator payments: LIVE key permission check. Read-only. Prints only PASS / FAIL / SKIP per permission, never a key.
//
//   node tools/creator-pay/live-check.js [path/to/env]     (default: the functions env file, STRIPE_SECRET_KEY)
//   node tools/creator-pay/live-check.js --json             machine-readable (still no secrets)
//
// Uses list / read calls, plus two POSTs aimed at a NON-EXISTENT account id (account_links, login_links): they can never
// create anything; Stripe answers "no such account" when the key may call them and 403 when it may not.
// Calls that will run on connected accounts (Stripe-Account header) are tried on the first connected account; with none yet
// the same list call runs on the platform account (the key permission is the same). Re-run after the first creator connects.
// Exit 0 = every permission PASS, 1 = something FAILed, 2 = no live key / test key given.
'use strict';
const fs = require('fs');
const { probe } = require('../../functions-src/creatorLive');

const ENV = process.argv.slice(2).find((a) => !a.startsWith('--')) || '/root/.hermes/profiles/chief-of-staff/scripts/functions.env';
const JSON_OUT = process.argv.includes('--json');
let key = process.env.STRIPE_SECRET_KEY || '';
if (!key) {
  for (const l of fs.readFileSync(ENV, 'utf8').split('\n')) {
    const m = l.match(/^\s*STRIPE_SECRET_KEY\s*=\s*(.+?)\s*$/);
    if (m) key = m[1].replace(/^['"]|['"]$/g, '');
  }
}
if (!/^(sk|rk)_live_/.test(key)) { console.error('No live key (sk_live_ / rk_live_) found. Nothing checked.'); process.exit(2); }
console.error('Key type: ' + key.slice(0, 7) + '... (' + (key.startsWith('rk_') ? 'restricted' : 'secret') + ')');

probe(key).then((r) => {
  const rows = r.results.map((x) => ({ id: x.id, permission: x.needs, call: x.label, result: x.skip ? 'SKIP' : x.pass ? 'PASS' : 'FAIL', http: x.status || '-' }));
  if (JSON_OUT) console.log(JSON.stringify({ ok: r.ok, rows }, null, 1));
  else {
    for (const x of rows) console.log(x.result.padEnd(5) + ' ' + x.call.padEnd(48) + ' tick: ' + x.permission + '  [HTTP ' + x.http + ']');
    const f = rows.filter((x) => x.result === 'FAIL');
    console.log('\n' + rows.filter((x) => x.result === 'PASS').length + ' PASS, ' + f.length + ' FAIL, ' + rows.filter((x) => x.result === 'SKIP').length + ' SKIP');
    if (f.length) console.log('Tick these on the key:\n  - ' + [...new Set(f.map((x) => x.permission))].join('\n  - '));
  }
  process.exit(rows.some((x) => x.result === 'FAIL') ? 1 : 0);
}).catch((e) => { console.error('check crashed:', e.message); process.exit(2); });
