// Market Data Agreement version must be the same in all three places (Owner 2026-11-01 / 2026-11-04).
// Run: node tools/tests/market-data-terms.test.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const R = (f) => fs.readFileSync(path.join(__dirname, '..', '..', f), 'utf8');
const pick = (f, re) => { const m = re.exec(R(f)); assert.ok(m, 'no version in ' + f); return m[1]; };
const fn = pick('functions-src/marketData.js', /const AGREEMENT_VERSION = '([^']+)'/);
const gate = pick('functions/api/chart/_rt.js', /export const MDA_VERSION = '([^']+)'/);
const page = pick('assets/market-data-agreement.js', /var VERSION = '([^']+)'/);
assert.equal(gate, fn, 'functions/api/chart/_rt.js MDA_VERSION != AGREEMENT_VERSION');
assert.equal(page, fn, 'assets/market-data-agreement.js VERSION != AGREEMENT_VERSION');
for (const f of ['workers/book-recorder/src/rt-auth.js', 'workers/discord-roles/src/rt-auth.js']) assert.equal(R(f), R('functions/api/chart/_rt.js'), f + ' differs from _rt.js');
assert.ok(/sign_in_provider === 'anonymous'/.test(R('functions-src/marketData.js')), 'acceptMarketDataAgreement must refuse anonymous accounts');
console.log('market-data-terms: all ok (' + fn + ')');
