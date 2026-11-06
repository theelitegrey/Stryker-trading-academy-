// Zscript library: offline tests (no network, no Firestore, no Stripe).
//   node tools/zs-library/lib.test.mjs
// 1) pure helpers in assets/zs-library.js (dataUsed, validate, filter, stars)
// 2) /api/zs/get delivery (functions/api/zs/get.js) with a mocked Firestore REST that answers like the rules would
// 3) creatorPay zsCheckout + Connect webhook (functions-src/creatorPay.js) against an in-memory Firestore and a mocked Stripe:
//    the buyer doc is written only after checkout.session.completed, refund / dispute end it, wrong account refused.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
let fails = 0, n = 0;
const ok = (c, m) => { n++; console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };

// ---------------------------------------------------------------- 1) helpers
const ctx = { console, globalThis: null }; ctx.globalThis = ctx; vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(root, 'assets/zs-library.js'), 'utf8'), ctx);
const Z = ctx.ZSLib;
ok(!!Z && typeof Z.validate === 'function', 'ZSLib loads without a DOM');
ok(JSON.stringify(Z.dataUsed('//@zscript 1\nx = book.imbalance(5)\ny = flow.delta\nplot(gex.callwall)')) === '["book","flow","gex"]', 'dataUsed finds book/flow/gex');
ok(JSON.stringify(Z.dataUsed('//@zscript 1\n// uses book.bid\ns = "opt.ivrank"\n/* flow.cvd */ plot(close)')) === '[]', 'dataUsed ignores comments and strings');
ok(JSON.stringify(Z.dataUsed('mybook.bid(1)\nopt.ivrank')) === '["opt"]', 'dataUsed needs the namespace at a word start');
ok(Z.isZscript('\n\n//@zscript 1\nindicator("x")') && !Z.isZscript('//@version=5\nindicator("x")'), 'isZscript reads the header line');
const base = { name: 'Delta Bands', desc: 'Draws bands.', category: 'order-flow', access: 'open', mode: 'free', source: '//@zscript 1\nindicator("D")\nplot(flow.delta)' };
const v = Z.validate(base);
ok(!v.error && v.sale.mode === 'free' && v.sale.price.amount === 0 && JSON.stringify(v.dataUsed) === '["flow"]', 'validate: free open-source ok');
ok(/name/.test(Z.validate({ ...base, name: 'ab' }).error), 'validate: short name refused');
ok(/zscript 1/.test(Z.validate({ ...base, source: 'indicator("x")' }).error), 'validate: missing header refused');
ok(/128 KB/.test(Z.validate({ ...base, source: '//@zscript 1\n' + 'x'.repeat(131072) }).error), 'validate: >128 KB refused');
ok(/payouts/.test(Z.validate({ ...base, mode: 'paid', amount: 10 }).error), 'validate: paid without payouts refused');
ok(/\$1 to \$999/.test(Z.validate({ ...base, mode: 'paid', amount: 1000, payoutsActive: true }).error), 'validate: price over $999 refused');
ok(/\$1 to \$999/.test(Z.validate({ ...base, mode: 'paid', amount: 0.5, payoutsActive: true }).error), 'validate: price under $1 refused');
const pv = Z.validate({ ...base, mode: 'paid', amount: '19.999', payoutsActive: true });
ok(!pv.error && pv.sale.price.amount === 20 && pv.sale.price.currency === 'USD', 'validate: author price rounded to cents, USD');
ok(/results|profits/.test(Z.validate({ ...base, desc: 'Guaranteed profits every day' }).error), 'validate: result claims refused');
ok(/results|profits/.test(Z.validate({ ...base, desc: '80% win rate' }).error), 'validate: win-rate claim refused');
ok(/category/.test(Z.validate({ ...base, category: 'magic' }).error), 'validate: unknown category refused');
ok(/open-source/.test(Z.validate({ ...base, access: 'secret' }).error), 'validate: unknown access refused');
const L = [
  { id: 'a', name: 'Alpha', category: 'trend', dataUsed: [], sale: { mode: 'free' }, ratingSum: 8, ratingCount: 2, addCount: 3, publishedAt: 1, authorName: 'Ana' },
  { id: 'b', name: 'Book Heat', category: 'order-flow', dataUsed: ['book'], sale: { mode: 'paid' }, ratingSum: 5, ratingCount: 1, addCount: 9, publishedAt: 3, authorName: 'Bo' },
  { id: 'c', name: 'Gamma', category: 'levels', dataUsed: ['gex'], sale: { mode: 'free' }, ratingSum: 0, ratingCount: 0, addCount: 0, publishedAt: 2, desc: 'call wall lines', authorName: 'Cy' }];
const ids = (f) => Z.filter(L, f).map((x) => x.id).join('');
ok(ids({ sort: 'new' }) === 'bca', 'filter: newest first');
ok(ids({ sort: 'added' }) === 'bac', 'filter: most added');
ok(ids({ sort: 'rated' }) === 'bac', 'filter: top rated (5.0 > 4.0 > none)');
ok(ids({ sale: 'paid' }) === 'b' && ids({ sale: 'free', sort: 'new' }) === 'ca', 'filter: free / paid');
ok(ids({ data: 'gex' }) === 'c' && ids({ cat: 'trend' }) === 'a', 'filter: data used / category');
ok(ids({ q: 'WALL' }) === 'c' && ids({ q: 'bo' }) === 'b', 'filter: search name, description, author');
ok(Z.stars(9, 2) === 4.5 && Z.stars(0, 0) === null, 'stars average, none when unrated');
ok(Z.price({ price: { amount: 19 } }) === '$19' && Z.price({ price: { amount: 4.5 } }) === '$4.50', 'price label');

// ---------------------------------------------------------------- 2) /api/zs/get
const Seal = await import(pathToFileURL(path.join(root, 'assets/creator-seal.js')).href);
const API = await import(pathToFileURL(path.join(root, 'functions/api/zs/get.js')).href);
const k = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
const keyText = JSON.stringify(await crypto.subtle.exportKey('jwk', k.privateKey));
const kj = JSON.parse(keyText), PUB = { kty: kj.kty, crv: kj.crv, x: kj.x, y: kj.y };
const PROG = { ops: [[1, 2, 3]], consts: ['secretName'] };
const SID_P0 = 'B'.repeat(20);
const sealed = await Seal.seal(PUB, JSON.stringify({ kind: 'zsbin', sid: SID_P0, authorUid: 'au', v: 1, program: PROG }));
const sealedOther = await Seal.seal(PUB, JSON.stringify({ kind: 'zsbin', sid: 'X'.repeat(20), authorUid: 'au', v: 1, program: PROG }));
const sealedOldV = await Seal.seal(PUB, JSON.stringify({ kind: 'zsbin', sid: SID_P0, authorUid: 'au', v: 0, program: PROG }));
const sealedNoBind = await Seal.seal(PUB, JSON.stringify({ kind: 'zsbin', program: PROG }));
ok(!JSON.stringify(sealed).includes('secretName'), 'stored bin is ciphertext (no program text)');
const enc = (v2) => (typeof v2 === 'string' ? { stringValue: v2 } : typeof v2 === 'number' ? { integerValue: String(v2) } : typeof v2 === 'boolean' ? { booleanValue: v2 }
  : v2 && typeof v2 === 'object' ? { mapValue: { fields: Object.fromEntries(Object.entries(v2).map(([a, b]) => [a, enc(b)])) } } : { nullValue: null });
const doc = (o) => ({ fields: Object.fromEntries(Object.entries(o).map(([a, b]) => [a, enc(b)])) });
const SID_O = 'A'.repeat(20), SID_P = 'B'.repeat(20), SID_R = 'C'.repeat(20);
// The mock answers like the rules: src/bin of the CURRENT version only for "allowed" callers.
function fsMock(allowed) {
  return async (url, opt) => {
    if (!(opt && opt.headers && opt.headers.authorization)) return new Response('', { status: 401 });
    const p = url.split('/documents/')[1];
    if (p === 'zsScripts/' + SID_O) return new Response(JSON.stringify(doc({ name: 'Open', version: 2, access: 'open', status: 'live', authorUid: 'au', sale: { mode: 'free' } })));
    if (p === 'zsScripts/' + SID_P) return new Response(JSON.stringify(doc({ name: 'Prot', version: 1, access: 'protected', status: 'live', authorUid: 'au', sale: { mode: 'paid' } })));
    if (p === 'zsScripts/' + SID_R) return new Response(JSON.stringify(doc({ name: 'Gone', version: 1, access: 'open', status: 'removed', authorUid: 'au', sale: { mode: 'free' } })));
    if (p === `zsScripts/${SID_O}/src/v2`) return allowed ? new Response(JSON.stringify(doc({ version: 2, source: '//@zscript 1\nplot(close)' }))) : new Response('{}', { status: 403 });
    if (p === `zsScripts/${SID_P}/bin/v1`) return allowed ? new Response(JSON.stringify(doc({ version: 1, sealed }))) : new Response('{}', { status: 403 });
    return new Response('{}', { status: 404 });
  };
}
const who = (uid) => ({ uid, token: 'tok-' + uid, email: uid + '@x.com', verified: true });
const w = await Seal.session();
const r1 = await API.deliver(who('u1'), { sid: SID_O }, keyText, fsMock(true));
ok(r1.access === 'open' && /plot\(close\)/.test(r1.source) && r1.version === 2, 'open-source: source of the current version delivered');
const r2 = await API.deliver(who('u1'), { sid: SID_P, pub: w.pub }, keyText, fsMock(true));
ok(r2.access === 'protected' && !r2.source && r2.sealed && !JSON.stringify(r2).includes('secretName'), 'protected: response has no source and no readable program');
const opened = JSON.parse(await Seal.openSession(w.privateKey, r2.sealed));
ok(JSON.stringify(opened.program) === JSON.stringify(PROG) && opened.sid === SID_P, 'protected: only the worker key opens it, program intact');
const w2 = await Seal.session();
let other = false; try { await Seal.openSession(w2.privateKey, r2.sealed); other = true; } catch (e) {}
ok(!other, 'protected: another worker key cannot open it');
const err = async (p) => { try { await p; return null; } catch (e) { return e; } };
let e = await err(API.deliver(who('u2'), { sid: SID_P, pub: w.pub }, keyText, fsMock(false)));
ok(e && e.status === 403 && e.code === 'noaccess' && /paid/.test(e.message), 'non-buyer: 403 noaccess (rules refused bin read)');
e = await err(API.deliver(who('u2'), { sid: SID_O }, keyText, fsMock(false)));
ok(e && e.status === 403, 'open-source but not allowed: 403');
e = await err(API.deliver(who('u1'), { sid: SID_P }, keyText, fsMock(true)));
ok(e && e.status === 400, 'protected without worker key: 400');
e = await err(API.deliver(who('u1'), { sid: SID_P, pub: w.pub }, null, fsMock(true)));
ok(e && e.status === 503, 'no server key: 503, nothing delivered');
e = await err(API.deliver(who('u1'), { sid: 'short' }, keyText, fsMock(true)));
ok(e && e.status === 400, 'bad sid: 400');
e = await err(API.deliver(who('u1'), { sid: SID_R }, keyText, fsMock(true)));
ok(e && e.status === 404 && /taken down/.test(e.message), 'taken-down script: 404 for others');
const tampered = { ...sealed, ct: sealed.ct.slice(0, -4) + 'AAAA' };
const fsBad = async (url, o) => (url.endsWith('/bin/v1') ? new Response(JSON.stringify(doc({ version: 1, sealed: tampered }))) : fsMock(true)(url, o));
e = await err(API.deliver(who('u1'), { sid: SID_P, pub: w.pub }, keyText, fsBad));
ok(e && e.status === 500 && e.code === 'seal', 'tampered bin: refused');
for (const [blob, what] of [[sealedOther, 'bin copied from another script'], [sealedOldV, 'bin for another version'], [sealedNoBind, 'bin without script binding']]) {
  const fsX = async (url, o) => (url.endsWith('/bin/v1') ? new Response(JSON.stringify(doc({ version: 1, sealed: blob }))) : fsMock(true)(url, o));
  e = await err(API.deliver(who('u1'), { sid: SID_P, pub: w.pub }, keyText, fsX));
  ok(e && e.status === 500 && e.code === 'seal', what + ': refused');
}

// ---------------------------------------------------------------- 3) creatorPay zsCheckout + webhook
const require = createRequire(import.meta.url);
const Module = require('module');
let DB = {}, auto = 0, clock = 1000;
const snapOf = (p) => ({ id: p.split('/').pop(), ref: docRef(p), exists: p in DB, data: () => DB[p] });
const merge = (a, b) => { const o = { ...a }; for (const x of Object.keys(b)) o[x] = (b[x] && typeof b[x] === 'object' && !Array.isArray(b[x]) && a[x] && typeof a[x] === 'object') ? merge(a[x], b[x]) : b[x]; return o; };
function docRef(p) {
  return { path: p, id: p.split('/').pop(), get: async () => snapOf(p),
    set: async (v2, o) => { DB[p] = o && o.merge ? merge(DB[p] || {}, v2) : { ...v2 }; },
    update: async (v2) => { DB[p] = { ...DB[p], ...v2 }; },
    create: async (v2) => { if (p in DB) { const x = new Error('6 ALREADY_EXISTS'); x.code = 6; throw x; } DB[p] = { ...v2 }; },
    collection: (c) => col(p + '/' + c) };
}
function col(c, filters = [], lim = 0) {
  return { doc: (id) => docRef(c + '/' + (id || 'auto' + (++auto))), add: async (v2) => { const p = c + '/auto' + (++auto); DB[p] = v2; return docRef(p); },
    where: (f, op, v2) => col(c, filters.concat([[f, v2]]), lim), limit: (l) => col(c, filters, l),
    get: async () => { const d = c.split('/').length + 1; const docs = Object.keys(DB).filter((p) => p.startsWith(c + '/') && p.split('/').length === d)
      .filter((p) => filters.every(([f, v2]) => DB[p][f] === v2)).map(snapOf); return { empty: !docs.length, size: docs.length, docs }; } };
}
const fakeDb = { collection: (c) => col(c), runTransaction: async (fn) => fn({ get: (r) => r.get(), set: (r, v2, o) => r.set(v2, o), update: (r, v2) => r.update(v2) }) };
const admin = { apps: [1], initializeApp() {}, firestore: Object.assign(() => fakeDb, { FieldValue: { serverTimestamp: () => ++clock, increment: (x) => x, delete: () => null }, Timestamp: { fromMillis: (x) => x, now: () => ++clock } }) };
const fx = { https: { onCall: (f) => f, onRequest: (f) => f, HttpsError: class extends Error { constructor(c, m) { super(c + ': ' + m); this.code = c; } } }, runWith() { return this; } };
const orig = Module._load;
Module._load = function (r, ...a) { if (r === 'firebase-admin') return admin; if (r === 'firebase-functions') return fx; return orig.call(this, r, ...a); };
process.env.STRIPE_SECRET_KEY = 'sk_test_' + 'offline';
process.env.STRIPE_CONNECT_WEBHOOK_SECRET = 'whsec_' + 'offline';
let sent = [];
globalThis.fetch = async (url, o) => {
  const p = url.replace('https://api.stripe.com/v1/', '').split('?')[0];
  sent.push({ method: o.method, path: p, body: decodeURIComponent(o.body || ''), acct: o.headers['Stripe-Account'] });
  let body = {};
  if (p === 'products') body = { id: 'prod_' + (++auto) };
  else if (p === 'prices') body = { id: 'price_' + (++auto) };
  else if (p === 'customers') body = { id: 'cus_' + (++auto) };
  else if (p === 'checkout/sessions') body = { id: 'cs_test_' + (++auto), url: 'https://checkout.stripe.com/c/pay/x' };
  else if (p.startsWith('charges/')) body = { id: p.split('/')[1], payment_intent: 'pi_1', amount: 1900, amount_refunded: 0 };
  return { ok: true, status: 200, json: async () => body };
};
const CP = require(path.join(root, 'functions-src/creatorPay.js')).__creatorPayInternals;
const SID = 'Z'.repeat(20);
function reset() {
  DB = {
    'admins/adm': {}, 'settings/commerce': { creatorFeePct: 0 },
    'creatorAccounts/au': { acct: 'acct_A', status: 'active', live: false },
    ['zsScripts/' + SID]: { authorUid: 'au', authorName: 'Ana', name: 'Book Heat', status: 'live', access: 'protected', sale: { mode: 'paid', price: { amount: 19, currency: 'USD' } } }
  };
  sent = [];
}
const ctxOf = (uid, email) => ({ auth: { uid, token: { email: email || uid + '@x.com' } } });
const call = async (uid, data, email) => { try { return await CP.actions.zsCheckout(uid, data, ctxOf(uid, email)); } catch (x) { return { err: x.code, msg: x.message }; } };
reset();
let r = await call('buyer', { sid: SID });
ok(r.url && /checkout\.stripe\.com/.test(r.url), 'zsCheckout: returns a Stripe Checkout URL');
const cs = sent.find((x) => x.path === 'checkout/sessions');
ok(cs && cs.acct === 'acct_A' && /mode=payment/.test(cs.body) && !/application_fee_amount/.test(cs.body), 'zsCheckout: direct charge on the AUTHOR\'s account, one-time, no fee at 0%');
const pr = sent.find((x) => x.path === 'prices');
ok(pr && /unit_amount=1900/.test(pr.body) && !/recurring/.test(pr.body), 'zsCheckout: price = author\'s $19 (1900 cents), not recurring');
const sessId = Object.keys(DB).find((p) => p.startsWith('creatorSessions/'));
ok(sessId && DB[sessId].kind === 'zs' && DB[sessId].sid === SID && DB[sessId].buyerUid === 'buyer', 'zsCheckout: session record kind zs');
ok(!DB[`zsScripts/${SID}/buyers/buyer`], 'zsCheckout: NO access before Stripe confirms');
DB['settings/commerce'].creatorFeePct = 10; sent = [];
await call('buyer2', { sid: SID });
ok(/application_fee_amount\]=190/.test(sent.find((x) => x.path === 'checkout/sessions').body), 'zsCheckout: platform fee from settings/commerce (10% = 190 cents)');
DB['settings/commerce'].creatorFeePct = 0;
ok((await call('au', { sid: SID })).err === 'failed-precondition', 'zsCheckout: author cannot buy own script');
DB[`zsScripts/${SID}`].sale = { mode: 'free', price: { amount: 0, currency: 'USD' } };
ok(/free/.test((await call('buyer', { sid: SID })).msg), 'zsCheckout: free script refused');
reset(); DB[`zsScripts/${SID}`].status = 'removed';
ok((await call('buyer', { sid: SID })).err === 'failed-precondition', 'zsCheckout: taken-down script refused');
reset(); DB['creatorAccounts/au'].status = 'restricted';
ok(/can't take payments/.test((await call('buyer', { sid: SID })).msg), 'zsCheckout: author payouts not active refused');
reset(); DB[`zsScripts/${SID}`].sale.price.amount = 5000;
ok(/outside \$1 to \$999/.test((await call('buyer', { sid: SID })).msg), 'zsCheckout: out-of-range price refused server-side');
reset();
ok((await call('buyer', { sid: 'bad' })).err === 'invalid-argument', 'zsCheckout: bad sid refused');
// gate: test key -> only admins / QA may start paid actions
ok(await CP.gate('adm', ctxOf('adm')).then(() => true, () => false), 'gate: admin passes on test key');
ok(!(await CP.gate('buyer', ctxOf('buyer')).then(() => true, () => false)), 'gate: normal member blocked on test key (no real charge path in tests)');
ok(await CP.gate('q', ctxOf('q', 'stryker-qa-1@example.com')).then(() => true, () => false), 'gate: QA throwaway passes on test key');

// webhook: checkout completed -> buyer doc
reset();
await call('buyer', { sid: SID });
const sid2 = Object.keys(DB).find((p) => p.startsWith('creatorSessions/')).split('/')[1];
const ev = (type, obj, acct) => CP.handleConnectEvent({ type, account: acct || 'acct_A', data: { object: obj } });
let res = await ev('checkout.session.completed', { id: sid2, client_reference_id: 'buyer', payment_status: 'unpaid', payment_intent: 'pi_1' });
ok(/ignored/.test(res) && !DB[`zsScripts/${SID}/buyers/buyer`], 'webhook: unpaid session grants nothing');
res = await ev('checkout.session.completed', { id: sid2, client_reference_id: 'evil', payment_status: 'paid', payment_intent: 'pi_1' });
ok(/refused/.test(res) && !DB[`zsScripts/${SID}/buyers/buyer`] && !DB[`zsScripts/${SID}/buyers/evil`], 'webhook: client_reference_id mismatch refused');
res = await ev('checkout.session.completed', { id: sid2, client_reference_id: 'buyer', payment_status: 'paid', payment_intent: 'pi_1', amount_total: 1900 }, 'acct_OTHER');
ok(/ignored|refused/.test(res) && !DB[`zsScripts/${SID}/buyers/buyer`], 'webhook: event from another connected account refused');
res = await ev('checkout.session.completed', { id: sid2, client_reference_id: 'buyer', payment_status: 'paid', payment_intent: 'pi_1', amount_total: 1900, customer_details: { email: 'b@x.com' } });
const bdoc = DB[`zsScripts/${SID}/buyers/buyer`];
ok(/zscript access granted/.test(res) && bdoc && bdoc.status === 'active', 'webhook: paid session -> buyers/{uid} active');
const sale = DB['creatorSales/pi_pi_1'];
ok(sale && sale.sid === SID && sale.creatorUid === 'au' && sale.amountCents === 1900 && sale.kind === 'one_time', 'webhook: sale recorded for the author (Creator Hub sales list)');
ok(/duplicate/.test(await ev('checkout.session.completed', { id: sid2, client_reference_id: 'buyer', payment_status: 'paid', payment_intent: 'pi_1' })), 'webhook: replay is a no-op');
res = await ev('charge.refunded', { id: 'ch_1', payment_intent: 'pi_1', refunded: true, amount: 1900, amount_refunded: 1900 });
ok(/script access ended/.test(res) && DB[`zsScripts/${SID}/buyers/buyer`].status === 'refunded', 'webhook: full refund ends script access');
DB[`zsScripts/${SID}/buyers/buyer`].status = 'active'; DB['creatorSales/pi_pi_1'].status = 'paid';
res = await ev('charge.dispute.created', { id: 'dp_1', charge: 'ch_1', reason: 'fraudulent' });
ok(/disputed/.test(res) && DB[`zsScripts/${SID}/buyers/buyer`].status === 'disputed', 'webhook: dispute ends script access');
const pre = JSON.stringify(Object.keys(DB).filter((p) => p.includes('/members/')));
ok(pre === '[]', 'webhook: no community membership side effects for script sales');

Module._load = orig;
console.log(fails ? fails + ' FAILED of ' + n : 'ALL PASS (' + n + ')');
process.exit(fails ? 1 : 0);
