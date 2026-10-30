// Delivery chain test: creator seals a template -> function opens, personalises, watermarks, seals to a worker
// session key -> worker opens. Firestore is mocked; the access decision itself is the rules (rules-test.py).
//   CREATOR_SEAL_KEY_FILE=<private JWK file> node tools/creator/ind-api.test.mjs   (a throwaway key is made if unset)
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const imp = (p) => import(pathToFileURL(path.join(root, p)).href);
const Seal = await imp('assets/creator-seal.js');
const O = await imp('assets/pine-obfuscate.js');
const API = await imp('functions/api/creator/ind.js');
let fails = 0; const check = (ok, m) => { console.log((ok ? 'PASS ' : 'FAIL ') + m); if (!ok) fails++; };

let keyText = process.env.CREATOR_SEAL_KEY_FILE ? fs.readFileSync(process.env.CREATOR_SEAL_KEY_FILE, 'utf8') : null;
if (!keyText) { const k = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']); keyText = JSON.stringify(await crypto.subtle.exportKey('jwk', k.privateKey)); }
const kj = JSON.parse(keyText); const PUB = { kty: kj.kty, crv: kj.crv, x: kj.x, y: kj.y };
const cfg = fs.readFileSync(path.join(root, 'assets', 'creator-config.js'), 'utf8');
if (process.env.CREATOR_SEAL_KEY_FILE) check(cfg.includes(kj.x) && cfg.includes(kj.y), 'creator-config.js SEAL_PUB matches the server key');
check(!/"d"\s*:/.test(cfg) && !cfg.includes(kj.d), 'no private key material in creator-config.js');

const SRC = '//@version=5\n// secret: the 21 EMA trick\nindicator("Mint Bands", overlay=true)\nlenX = input.int(21, "Length")\nsecretAvg(src, n) =>\n    ta.ema(src, n)\nbasisLine = secretAvg(close, lenX)\nplot(basisLine, "Basis")\n';
const tp = O.template(SRC);
const sealedVault = await Seal.seal(PUB, JSON.stringify(Object.assign({ kind: 'tpl' }, tp)));
check(!JSON.stringify(sealedVault).includes('secretAvg') && !JSON.stringify(sealedVault).includes('Mint'), 'vault blob carries no readable source');

const enc = (v) => (typeof v === 'string' ? { stringValue: v } : typeof v === 'number' ? { integerValue: String(v) } : typeof v === 'boolean' ? { booleanValue: v }
  : v && typeof v === 'object' ? { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, enc(x)])) } } : { nullValue: null });
const doc = (o) => ({ fields: Object.fromEntries(Object.entries(o).map(([k, v]) => [k, enc(v)])) });
function mockFetch(allow) {
  return async (url, opt) => {
    const auth = opt && opt.headers && opt.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ')) return new Response('', { status: 401 });
    if (/\/indicators\/ind000000000001$/.test(url)) return new Response(JSON.stringify(doc({ name: 'Mint Bands', status: 'live', version: 2, protected: true })), { status: 200 });
    if (/\/vault\/v2$/.test(url)) return allow ? new Response(JSON.stringify(doc({ version: 2, sealed: sealedVault })), { status: 200 }) : new Response('{}', { status: 403 });
    return new Response('{}', { status: 404 });
  };
}
const w1 = await Seal.session(), w2 = await Seal.session();
const who = (uid) => ({ uid, token: 'tok-' + uid, email: uid + '@x.com', verified: true });
const body = (pub) => ({ cid: 'alpha-desk', iid: 'ind000000000001', pub });
const r1 = await API.deliver(who('buyerA'), body(w1.pub), keyText, mockFetch(true));
const s1 = JSON.parse(await Seal.openSession(w1.privateKey, r1.sealed)).source;
check(r1.version === 2 && r1.protected === true, 'delivers the CURRENT version (holders get new versions on load)');
check(!/secret|secretAvg|basisLine/.test(s1) && /lenX = input\.int/.test(s1) && /indicator\("Mint Bands"/.test(s1), 'delivered script: comments + own names gone, inputs kept');
let opened = true; try { await Seal.openSession(w2.privateKey, r1.sealed); } catch (e) { opened = false; }
check(!opened, 'another session key cannot open the delivery');
const r2 = await API.deliver(who('buyerB'), body(w2.pub), keyText, mockFetch(true));
const s2 = JSON.parse(await Seal.openSession(w2.privateKey, r2.sealed)).source;
check(s1 !== s2, 'two buyers get different text');
const marks = O.findMarks(s1);
const want = await API.markBytes(keyText, 'buyerA');
check(marks.length === 1 && Buffer.from(marks[0]).equals(Buffer.from(want)), 'watermark carries buyer A');
check(!Buffer.from(O.findMarks(s2)[0]).equals(Buffer.from(want)), 'buyer B watermark differs');
let code = '';
try { await API.deliver(who('late'), body(w1.pub), keyText, mockFetch(false)); } catch (e) { code = e.code + ' ' + e.status; }
check(code === 'noaccess 403', 'no access right now (expired / banned / revoked) -> 403 noaccess');
code = ''; try { await API.deliver(who('x'), { cid: 'alpha-desk', iid: 'bad', pub: w1.pub }, keyText, mockFetch(true)); } catch (e) { code = e.code; }
check(code === 'bad', 'bad id refused');
code = ''; try { await API.deliver(who('x'), body(w1.pub), '', mockFetch(true)); } catch (e) { code = e.code; }
check(code === 'nokey', 'no server key -> clear 503');
// guard still passes on the delivered (obfuscated + watermarked) text
const G = { exports: {} }; new Function('module', fs.readFileSync(path.join(root, 'assets', 'chart-pine-guard.js'), 'utf8'))(G);
const guard = G.exports.check ? G.exports : G.exports.StrykerPineGuard;
check(guard && guard.check(s1).ok, 'safety guard accepts the delivered script');
process.exit(fails ? 1 : 0);
