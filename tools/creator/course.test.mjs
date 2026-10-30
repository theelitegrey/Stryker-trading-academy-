// Phase C tests that need no browser: video link parsing, player message parsing, analytics maths, and the file API
// (access decision mocked as Firestore would answer; the REAL decision is the rules, tested by rules-test.py).
//   node tools/creator/course.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { pathToFileURL, fileURLToPath } from 'node:url';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const imp = (p) => import(pathToFileURL(path.join(root, p)).href);
let fails = 0; const check = (ok, m) => { console.log((ok ? 'PASS ' : 'FAIL ') + m); if (!ok) fails++; };

// ---- browser scripts in a sandbox
const win = { URL, CH: { esc: (s) => String(s) } }; win.window = win; win.document = {}; win.location = { origin: 'https://tradezoro.com' };
vm.createContext(win);
for (const f of ['assets/creator-player.js']) vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), win, { filename: f });
const P = win.CHP;
const pv = (u) => P.parseVideo(u);
check(pv('https://www.youtube.com/watch?v=dQw4w9WgXcQ').embed === 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ', 'youtube watch link');
check(pv('https://youtu.be/dQw4w9WgXcQ?t=5').id === 'dQw4w9WgXcQ', 'youtu.be link');
check(pv('https://www.youtube.com/shorts/dQw4w9WgXcQ').provider === 'youtube', 'youtube shorts');
check(pv('https://www.youtube.com/watch?v=dQw4w9WgXcQ').thumb.endsWith('/dQw4w9WgXcQ/hqdefault.jpg'), 'youtube thumbnail');
check(pv('https://vimeo.com/76979871').embed === 'https://player.vimeo.com/video/76979871', 'vimeo');
check(pv('https://vimeo.com/76979871/abcdef123456').embed.includes('?h=abcdef123456'), 'vimeo unlisted hash kept');
check(pv('https://www.loom.com/share/0f9d4b0b2b5c4d1e8f3a7b6c5d4e3f2a').embed === 'https://www.loom.com/embed/0f9d4b0b2b5c4d1e8f3a7b6c5d4e3f2a', 'loom');
check(pv('https://iframe.mediadelivery.net/embed/12345/0a1b2c3d-4e5f-6789-abcd-ef0123456789').provider === 'bunny', 'bunny embed');
check(pv('https://iframe.mediadelivery.net/play/12345/0a1b2c3d-4e5f-6789-abcd-ef0123456789').embed.includes('/embed/12345/'), 'bunny play link becomes embed');
check(pv('https://customer-abc123.cloudflarestream.com/0123456789abcdef0123456789abcdef/watch').embed === 'https://customer-abc123.cloudflarestream.com/0123456789abcdef0123456789abcdef/iframe', 'cloudflare stream');
for (const bad of ['http://www.youtube.com/watch?v=dQw4w9WgXcQ', 'https://evil.example/watch?v=dQw4w9WgXcQ', 'https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ', 'javascript:alert(1)', 'https://www.youtube.com/watch', 'https://vimeo.com/abc', '', 'not a url', 'https://evilvimeo.com/76979871', 'https://x.cloudflarestream.com.evil.io/0123456789abcdef0123456789abcdef'])
  check(pv(bad) === null, 'rejects ' + JSON.stringify(bad));
check(!/["'<>]/.test((pv('https://www.youtube.com/watch?v=abc"onload=x') || {}).embed || ''), 'no quote can leak into an embed URL');

check(JSON.stringify(P.readMessage('youtube', JSON.stringify({ event: 'infoDelivery', info: { currentTime: 30, duration: 100 } }))) === '{"t":30,"d":100}', 'youtube progress message');
check(P.readMessage('youtube', JSON.stringify({ event: 'infoDelivery', info: { playerState: 0 } })).ended === true, 'youtube ended');
check(P.readMessage('vimeo', JSON.stringify({ event: 'timeupdate', data: { seconds: 12, duration: 60 } })).t === 12, 'vimeo timeupdate');
check(P.readMessage('vimeo', JSON.stringify({ event: 'ended' })).ended === true, 'vimeo ended');
check(P.readMessage('youtube', 'garbage') === null && P.readMessage('youtube', null) === null && P.readMessage('loom', '{"event":"x"}') === null, 'junk messages ignored');
check(/@x\.io · \d{1,2} [A-Z][a-z]{2} \d{4} \d\d:\d\d$/.test(P.wmLabel({ email: 'a@x.io' })), 'watermark label = email + date + time');

// ---- analytics (creator-courses.js exposes the pure function)
const w2 = { URL, CH: { esc: (s) => String(s), cfg: {} }, db: {}, document: {}, location: {}, crypto: globalThis.crypto, stkHtml: (x) => x, navigator: {} }; w2.window = w2; vm.createContext(w2);
vm.runInContext(fs.readFileSync(path.join(root, 'assets/creator-courses.js'), 'utf8'), w2);
const A = w2.CHCourses._analytics;
const L = ['a', 'b', 'c', 'd'].map((id) => ({ id, title: id.toUpperCase() }));
const prog = (done) => ({ done: Object.fromEntries(done.map((d) => [d, 1])) });
let r = A(L, [prog(['a', 'b', 'c', 'd']), prog(['a', 'b', 'c']), prog(['a', 'b']), prog(['a'])]);
check(r.learners === 4 && r.rows.map((x) => x.pct).join() === '100,75,50,25', 'completion % per lesson');
check(r.drop && r.drop.row.l.id === 'b' && r.drop.d === 25, 'drop-off = biggest fall versus the lesson before (first on ties)');
check(r.finished === 1 && r.finishedPct === 25, 'finished the whole course');
r = A(L, [prog(['a', 'b', 'c', 'd'])]);
check(r.drop === null && r.finishedPct === 100, 'no drop-off when everyone finishes');
r = A(L, []);
check(r.learners === 0 && r.rows.every((x) => x.pct === 0) && r.drop === null, 'no learners: zeros, no division by zero');
r = A([L[0]], [prog([])]);
check(r.rows[0].pct === 0, 'one lesson, nobody done');

// ---- file API
const Seal = await imp('assets/creator-seal.js');
const File = await imp('functions/api/creator/file.js');
const k = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
const keyText = JSON.stringify(await crypto.subtle.exportKey('jwk', k.privateKey)); const kj = JSON.parse(keyText);
const TOK = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const sealed = await Seal.seal({ kty: kj.kty, crv: kj.crv, x: kj.x, y: kj.y }, TOK);
const enc = (v) => (typeof v === 'string' ? { stringValue: v } : typeof v === 'number' ? { integerValue: String(v) } : typeof v === 'boolean' ? { booleanValue: v }
  : Array.isArray(v) ? { arrayValue: { values: v.map(enc) } } : v && typeof v === 'object' ? { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([a, x]) => [a, enc(x)])) } } : { nullValue: null });
const doc = (o) => ({ fields: Object.fromEntries(Object.entries(o).map(([a, v]) => [a, enc(v)])) });
const FILE = { fid: 'FILE0000000000001', name: 'guide.pdf', size: 1000, ct: 'application/pdf', download: false, sealed };
const calls = [];
const mock = (allow, bodyDoc = { type: 'pdf', file: FILE, attachments: [FILE], updatedAt: 'x' }) => async (url, opt = {}) => {
  calls.push({ url, auth: (opt.headers || {}).authorization || '' });
  if (url.includes('firestore.googleapis.com')) {
    if (!allow) return new Response('{"error":{"status":"PERMISSION_DENIED"}}', { status: 403 });
    return new Response(JSON.stringify(doc(bodyDoc)), { status: 200 });
  }
  if (url.startsWith('https://firebasestorage.googleapis.com/')) return url.includes('token=' + TOK) ? new Response('%PDF-1.4 bytes', { status: 200 }) : new Response('no', { status: 403 });
  return new Response('?', { status: 500 });
};
const Q = { cid: 'alpha-desk', crid: 'crs000000001', lid: 'les000000001', i: 'main' };
const who = { uid: 'u1', token: 'MEMBERTOKEN' };
let out = await File.fileFor(who, Q, keyText, mock(true));
check(out.ct === 'application/pdf' && (await new Response(out.stream).text()).startsWith('%PDF'), 'member with access gets the bytes');
check(calls.some((c) => c.url.includes('/content/body') && c.auth === 'Bearer MEMBERTOKEN'), 'access is read with the CALLER token (rules decide)');
check(!JSON.stringify(out.file).includes(TOK), 'download token never in the returned file info');
let e = await File.fileFor(who, Q, keyText, mock(false)).catch((x) => x);
check(e.status === 403 && e.code === 'noaccess', 'rules deny (plan / drip / order) -> 403, no bytes fetched');
check(!calls.slice(-1)[0].url.includes('firebasestorage'), 'storage is never contacted after a denial');
calls.length = 0;
out = await File.fileFor(null, Q, keyText, mock(true));
check(calls[0].auth === '' && out.ct === 'application/pdf', 'signed-out request carries no token (only free previews pass the rules)');
e = await File.fileFor(who, { ...Q, i: '0' }, keyText, mock(true)).catch((x) => x);
check(e instanceof Error === false || e.stream, 'attachment index 0 works');
e = await File.fileFor(who, { ...Q, i: '5' }, keyText, mock(true)).catch((x) => x);
check(e.status === 404, 'missing attachment -> 404');
for (const bad of [{ ...Q, cid: '../x' }, { ...Q, crid: 'short' }, { ...Q, lid: 'a/b/c/d/e/f/g' }, { ...Q, i: '9' }, { ...Q, i: '-1' }, { ...Q, i: '../../x' }])
  check((await File.fileFor(who, bad, keyText, mock(true)).catch((x) => x)).status === 400, 'bad parameter rejected ' + JSON.stringify(bad.i + bad.cid + bad.crid).slice(0, 40));
e = await File.fileFor(who, Q, '', mock(true)).catch((x) => x);
check(e.status === 503, 'no server key -> 503 not switched on');
const k2 = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
e = await File.fileFor(who, Q, JSON.stringify(await crypto.subtle.exportKey('jwk', k2.privateKey)), mock(true)).catch((x) => x);
check(e.status === 500 && e.code === 'seal', 'sealed token not openable with another key');
out = await File.fileFor(who, Q, keyText, mock(true, { type: 'pdf', file: { ...FILE, ct: 'text/html' }, attachments: [], updatedAt: 'x' }));
check(out.ct === 'application/octet-stream', 'unknown content type is served as octet-stream, never html');
const resp = await File.onRequest({ request: new Request('https://x/api/creator/file?cid=alpha-desk&crid=crs000000001&lid=les000000001&i=main'), env: {} });
check(resp.status === 503 || resp.status === 404, 'handler without a key answers cleanly (' + resp.status + ')');
const respBad = await File.onRequest({ request: new Request('https://x/api/creator/file?cid=alpha-desk&crid=crs000000001&lid=les000000001&i=main', { method: 'POST' }), env: {} });
check(respBad.status === 405, 'POST refused');

console.log(fails ? fails + ' FAILED' : 'all passed'); process.exit(fails ? 1 : 0);
