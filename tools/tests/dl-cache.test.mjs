// /dl/<file> edge cache is keyed per release tag, so a new desktop release is served, not the old exe.
// Run: node tools/tests/dl-cache.test.mjs
import assert from 'node:assert/strict';
import { serve } from '../../functions/dl/[file].js';

function memCache() {
  const m = new Map();
  return { m, match: async (k) => { const r = m.get(k.url); return r ? r.clone() : undefined; }, put: async (k, r) => { m.set(k.url, r); } };
}
let latest = 'desktop-v1.0.0';
const calls = [];
const fetchImpl = async (u, init) => {
  u = String(u); calls.push(u);
  if (u.endsWith('/releases/latest')) return new Response(null, { status: 302, headers: { location: 'https://github.com/x/y/releases/tag/' + latest } });
  const m = /releases\/download\/(desktop-v[\d.]+)\/(.+)$/.exec(u);
  if (m) return new Response('EXE ' + m[1], { headers: { 'content-length': String(('EXE ' + m[1]).length) } });
  return new Response('latest-fallback');
};
const pending = [];
const ctx = (file) => ({ params: { file }, request: new Request('https://tradezoro.com/dl/' + file), waitUntil: (p) => pending.push(p) });
const run = async (file, deps) => { const r = await serve(ctx(file), deps); await Promise.all(pending.splice(0)); return r; };

const cache = memCache();
let r = await run('TradeZoro-Setup.exe', { cache, fetchImpl });
assert.equal(await r.text(), 'EXE desktop-v1.0.0');
assert.equal(r.headers.get('x-tz-release'), 'desktop-v1.0.0');
assert.ok(cache.m.has('https://tradezoro.com/dl/desktop-v1.0.0/TradeZoro-Setup.exe'));
// second hit: edge cache, no download from GitHub
calls.length = 0;
r = await run('TradeZoro-Setup.exe', { cache, fetchImpl });
assert.equal(await r.text(), 'EXE desktop-v1.0.0');
assert.ok(!calls.some((u) => u.includes('/download/')), 'served from cache');
assert.equal(r.headers.get('cache-control'), 'public, max-age=300, s-maxage=300', 'plain /dl URL never pinned past the 5-min tag check');
// new release published; once the 5 min tag cache expires (simulated by dropping it) the new exe is served
latest = 'desktop-v1.0.1';
cache.m.delete('https://tradezoro.com/dl/__latest-tag');
r = await run('TradeZoro-Setup.exe', { cache, fetchImpl });
assert.equal(await r.text(), 'EXE desktop-v1.0.1');
assert.equal(r.headers.get('content-disposition'), 'attachment; filename="TradeZoro-Setup.exe"');
// unknown file
assert.equal((await run('evil.exe', { cache, fetchImpl })).status, 404);
// GitHub tag lookup fails: stream latest, never write the edge cache
const c2 = memCache();
r = await run('TradeZoro-Portable.exe', { cache: c2, fetchImpl: async (u) => { if (String(u).endsWith('/releases/latest')) throw new Error('down'); return new Response('latest-fallback'); } });
assert.equal(await r.text(), 'latest-fallback');
assert.equal(c2.m.size, 0);
console.log('dl cache tests: ok');
