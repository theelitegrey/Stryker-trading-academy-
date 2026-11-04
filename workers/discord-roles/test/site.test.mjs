// Site-Pro -> official server role. Mock Discord + Firestore.   node workers/discord-roles/test/site.test.mjs
import { DatabaseSync } from 'node:sqlite';
import { Core } from '../src/core.js';
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const db = new DatabaseSync(':memory:');
const sql = { exec(q, ...a) { const st = db.prepare(q); return /^\s*select/i.test(q) ? st.all(...a) : (st.run(...a), []); } };
const G = '1565740274116857887', PRO = '6000000001', MEM = '6000000002', OTHER = '6000000003', BOT = '1999999999';
const NOW = Date.parse('2026-11-04T10:00:00Z');
const W = { fs: {}, members: {}, calls: [], fsDown: false };
const roles = [{ id: G, name: '@everyone', position: 0 }, { id: PRO, name: 'TradeZoro Pro', position: 3 }, { id: MEM, name: 'Member', position: 2 }, { id: OTHER, name: 'Self role', position: 1 }, { id: '6000000009', name: 'Bot', position: 9, managed: true }];
const j = (o, s = 200) => new Response(s === 204 ? null : JSON.stringify(o), { status: s });
const doc = (f) => ({ fields: f });
async function mockFetch(url, opt = {}) {
  url = String(url); const m = opt.method || 'GET';
  if (url.startsWith('https://securetoken')) return j({ id_token: 'fb', refresh_token: 'r2', expires_in: '3600' });
  if (url.includes('firestore.googleapis.com')) {
    const path = url.split('/documents/')[1];
    if (path.startsWith('plans')) return j({ documents: [{ name: 'x/plans/pro', fields: { rank: { integerValue: '1' }, name: { stringValue: 'Pro' } } }] });
    if (W.fsDown) return j({}, 503);
    const d = W.fs[path]; return d ? j(d) : j({}, 404);
  }
  const path = url.replace('https://discord.com/api/v10', ''); W.calls.push(m + ' ' + path);
  if (path === '/oauth2/token') { const b = new URLSearchParams(opt.body); return b.get('grant_type') === 'authorization_code' ? j({ access_token: 'ua', refresh_token: 'ur', expires_in: 604800 }) : j({ access_token: 'ua2', expires_in: 604800 }); }
  if (path === '/users/@me') return j({ id: '7000000001', username: 'trader', global_name: 'Trader One' });
  if (path === `/guilds/${G}/roles`) return j(roles);
  let mm;
  if ((mm = path.match(/^\/guilds\/\d+\/members\/(\d+)$/))) {
    const id = mm[1];
    if (m === 'GET') return id === BOT ? j({ roles: ['6000000009'] }) : W.members[id] ? j({ roles: [...W.members[id]] }) : j({}, 404);
    if (m === 'PUT') { W.members[id] = new Set(JSON.parse(opt.body).roles || []); return j({}, 201); }
  }
  if ((mm = path.match(/^\/guilds\/\d+\/members\/(\d+)\/roles\/(\d+)$/))) {
    const s = W.members[mm[1]]; if (!s) return j({}, 404);
    if (m === 'PUT') { s.add(mm[2]); return j({}, 204); }
    if (m === 'DELETE') { s.delete(mm[2]); return j({}, 204); }
  }
  return j({ message: 'unmocked ' + m + ' ' + path }, 500);
}
const env = { DISCORD_BOT_TOKEN: 'b', DISCORD_CLIENT_ID: BOT, DISCORD_CLIENT_SECRET: 's', FB_API_KEY: 'k', SITE_URL: 'https://tradezoro.com', PUBLIC_URL: 'https://x.test' };
let now = NOW;
const c = new Core(sql, env, { fetchImpl: mockFetch, now: () => now, verify: async (t) => (t.startsWith('tok-') ? t.slice(4) : null), sleep: async () => {} });
const post = (path, who, body) => c.route(new Request('https://x.test' + path, { method: 'POST', headers: who ? { authorization: 'Bearer tok-' + who } : {}, body: JSON.stringify(body || {}) }));
const student = (plan, extra = {}) => doc({ plan: { stringValue: plan }, ...extra });
const link = async (uid) => {
  const r = await post('/link/start', uid, { site: true, refreshToken: 'rf' });
  const cb = await c.route(new Request('https://x.test/oauth/callback?code=c&state=' + encodeURIComponent(new URL(r.body.url).searchParams.get('state'))));
  return cb.redirect;
};

let r = await post('/site/sync', null, {});
ok(r.status === 401, 'signed out -> 401');
r = await post('/site/sync', 'free1', {});
ok(r.body.linked === false && Object.keys(W.members).length === 0, 'unlinked -> nothing happens on Discord');
ok(!W.calls.some((x) => x.startsWith('PUT') || x.startsWith('DELETE')), 'unlinked: no Discord write');

// Pro member links: joins WITH the Pro role
W.fs['students/pro1'] = student('Pro');
ok((await link('pro1')) === 'https://tradezoro.com/settings?discord=linked', 'callback returns to /settings');
ok(W.members['7000000001'] && W.members['7000000001'].has(PRO), 'Pro: joined the server with the Pro role at once');
ok(!W.members['7000000001'].has(MEM), 'member role not given when SITE_MEMBER_ROLE_ID unset');
// other roles untouched
W.members['7000000001'].add(OTHER);
// lapsed
W.fs['students/pro1'] = student('Pro', { paidThroughMillis: { integerValue: String(NOW - 10 * 86400000) } });
let s = await c.sweep();
ok(!W.members['7000000001'].has(PRO) && W.members['7000000001'].has(OTHER), 'lapsed (past 3-day grace): Pro removed by the 15 min sweep, other role kept');
// grace
W.fs['students/pro1'] = student('Pro', { paidThroughMillis: { integerValue: String(NOW - 86400000) } });
await c.sweep();
ok(W.members['7000000001'].has(PRO), 'inside the 3-day grace: Pro role added back');
// cancelled
W.fs['students/pro1'] = student('Pro', { subscriptionStatus: { stringValue: 'cancelled' } });
await c.sweep();
ok(!W.members['7000000001'].has(PRO), 'cancelled: removed');
// Firestore down: nothing changes
W.fs['students/pro1'] = student('Pro'); await c.sweep(); ok(W.members['7000000001'].has(PRO), 'back to Pro: role added');
W.fsDown = true; W.calls = []; c.tokCache.clear(); await c.sweep();
ok(W.members['7000000001'].has(PRO) && !W.calls.some((x) => x.startsWith('DELETE')), 'Firestore outage: role NOT stripped');
W.fsDown = false;
// free plan
W.fs['students/pro1'] = student('Free'); await c.sweep();
ok(!W.members['7000000001'].has(PRO), 'plan Free: removed');

// free member links: joins without the role
delete W.members['7000000001']; db.exec('DELETE FROM links'); db.exec('DELETE FROM site');
W.fs['students/free1'] = student('Free'); await link('free1');
ok(W.members['7000000001'] && W.members['7000000001'].size === 0, 'free member: joins server, no Pro role');
r = await post('/site/sync', 'free1', {});
ok(r.body.linked && r.body.username === 'Trader One' && r.body.pro === false && r.body.state === 'active', 'sync reports Connected as <name>, pro false');
ok(!JSON.stringify(r.body).match(/ua|ur|rf/), 'no token in the answer');
// admin
db.exec('DELETE FROM links'); db.exec('DELETE FROM site'); delete W.members['7000000001'];
W.fs['admins/adm1'] = doc({}); await link('adm1');
ok(W.members['7000000001'].has(PRO), 'admin (no student plan) gets the Pro role');
// already in server as free, upgrades -> immediate on sync
db.exec('DELETE FROM links'); db.exec('DELETE FROM site'); W.members['7000000001'] = new Set([OTHER]);
W.fs['students/up1'] = student('Free'); await link('up1');
W.fs['students/up1'] = student('Pro'); await post('/site/sync', 'up1', {});
ok(W.members['7000000001'].has(PRO) && W.members['7000000001'].has(OTHER), 'upgrade + check: Pro added, other role kept');
// member role opt-in
c.env.SITE_MEMBER_ROLE_ID = MEM; W.members['7000000001'].delete(MEM); await post('/site/sync', 'up1', {});
ok(W.members['7000000001'].has(MEM), 'member role added when configured');
// role above the bot is refused
roles.find((x) => x.id === PRO).position = 20; W.members['7000000001'].delete(PRO); await post('/site/sync', 'up1', {});
ok(!W.members['7000000001'].has(PRO), 'Pro role above the bot: not assigned');
roles.find((x) => x.id === PRO).position = 3;
// rate limit
let last; for (let i = 0; i < 14; i++) last = await post('/site/sync', 'rl1', {});
ok(last.status === 429, 'rate limit: 429 after 12 calls a minute');
// unlink strips role
r = await post('/unlink', 'up1', {}); await post('/site/sync', 'up1', {});
ok(!W.members['7000000001'].has(PRO) && !c.one('SELECT 1 x FROM site WHERE uid=?', 'up1'), 'unlink removes Pro role + site row');
console.log(fails ? '\n' + fails + ' FAILED' : '\nALL PASSED'); process.exit(fails ? 1 : 0);
