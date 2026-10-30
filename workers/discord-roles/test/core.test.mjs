// Tests for src/core.js against a mock Discord + mock Firestore + mock Firebase token endpoint.
//   node workers/discord-roles/test/core.test.mjs
import { DatabaseSync } from 'node:sqlite';
import { Core, BOT_PERMS } from '../src/core.js';

let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const db = new DatabaseSync(':memory:');
const sql = { exec(q, ...a) { const st = db.prepare(q); return /^\s*select/i.test(q) ? st.all(...a) : (st.run(...a), []); } };

// ---- mock world -------------------------------------------------------------------------------------------
const W = { now: Date.parse('2026-11-01T10:00:00Z'), fs: {}, guildMembers: {}, roles: [], calls: [], dcBanned: new Set(), fbDead: null, revoked: 0 };
W.roles = [{ id: '5000000001', name: '@everyone', position: 0 }, { id: '5000000002', name: 'TradeZoro', position: 5, managed: true }, { id: '5000000003', name: 'Gold', position: 2 },
  { id: '5000000004', name: 'Silver', position: 1 }, { id: '5000000005', name: 'Boss', position: 9 }];
const GID = '5000000001';
const fsv = (v) => v === null ? { nullValue: null } : v instanceof Date ? { timestampValue: v.toISOString() } : typeof v === 'string' ? { stringValue: v } : typeof v === 'number' ? { integerValue: String(v) } : { booleanValue: v };
const setDoc = (path, o) => { W.fs[path] = { fields: Object.fromEntries(Object.entries(o).map(([k, v]) => [k, fsv(v)])) }; };
const reset = () => {
  W.fs = {}; W.guildMembers = {}; W.calls = []; W.fbDead = null;
  setDoc('communities/alpha-desk', { ownerUid: 'own', status: 'active' });
  setDoc('communities/alpha-desk/plans/p1', { name: 'Gold', discordRoleId: '5000000003' });
  setDoc('communities/alpha-desk/plans/p2', { name: 'Silver', discordRoleId: '5000000004' });
  setDoc('communities/alpha-desk/plans/p3', { name: 'NoRole' });
  setDoc('communities/alpha-desk/plans/p4', { name: 'TooHigh', discordRoleId: '5000000005' });
  setDoc('communities/alpha-desk/members/u1', { planId: 'p1', role: 'member', status: 'active', expiresAt: null });
};
const j = (o, s = 200) => new Response(s === 204 ? null : JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json' } });
async function mockFetch(url, opt = {}) {
  url = String(url); const m = opt.method || 'GET';
  if (url.startsWith('https://securetoken.googleapis.com')) return W.fbDead ? j({ error: { message: W.fbDead } }, 400) : j({ id_token: 'fbtok', refresh_token: 'fbr2', expires_in: '3600' });
  if (url.includes('firestore.googleapis.com')) {
    if (!opt.headers.authorization.startsWith('Bearer ')) return j({}, 401);
    const path = url.split('/documents/')[1]; const d = W.fs[path];
    return d ? j(d) : j({}, 404);
  }
  const path = url.replace('https://discord.com/api/v10', ''); W.calls.push(m + ' ' + path);
  if (path === '/oauth2/token') {
    const b = new URLSearchParams(opt.body);
    if (b.get('grant_type') === 'authorization_code') return b.get('code') === 'botcode' ? j({ access_token: 'a', guild: { id: GID, name: 'Alpha Server' } }) : j({ access_token: 'ua1', refresh_token: 'ur1', expires_in: 604800 });
    return j({ access_token: 'ua2', refresh_token: 'ur2', expires_in: 604800 });
  }
  if (path === '/oauth2/token/revoke') { W.revoked++; return j({}); }
  if (path === '/users/@me') return j({ id: '7000000001', username: 'trader', global_name: 'Trader One' });
  if (path === `/guilds/${GID}/roles`) return j(W.roles);
  if (path === `/guilds/${GID}`) return j({ id: GID, system_channel_id: '9000000001' });
  if (path === '/channels/9000000001/invites') return j({ code: 'abc123' });
  let mm;
  if ((mm = path.match(/^\/guilds\/\d+\/members\/(\d+)$/))) {
    const id = mm[1];
    if (m === 'GET') return id === '1999999999' ? j({ roles: ['5000000002'] }) : W.guildMembers[id] ? j({ roles: [...W.guildMembers[id]] }) : j({ message: 'Unknown Member' }, 404);
    if (m === 'PUT') { if (W.dcBanned.has(id)) return j({ code: 40007 }, 403); W.guildMembers[id] = new Set(JSON.parse(opt.body).roles || []); return j({}, 201); }
  }
  if ((mm = path.match(/^\/guilds\/\d+\/members\/(\d+)\/roles\/(\d+)$/))) {
    const s = W.guildMembers[mm[1]]; if (!s) return j({}, 404);
    if (m === 'PUT') { s.add(mm[2]); return j({}, 204); }
    if (m === 'DELETE') { s.delete(mm[2]); return j({}, 204); }
  }
  return j({ message: 'unmocked ' + m + ' ' + path }, 500);
}
const env = { DISCORD_BOT_TOKEN: 'bot', DISCORD_CLIENT_ID: '1999999999', DISCORD_CLIENT_SECRET: 'sec', FB_API_KEY: 'k', SITE_URL: 'https://tradezoro.com', PUBLIC_URL: 'https://x.test' };
const mk = (e = env) => new Core(sql, e, { fetchImpl: mockFetch, now: () => W.now, verify: async (t) => (t.startsWith('tok-') ? t.slice(4) : null), sleep: async () => {} });
const req = (path, who, body) => new Request('https://x.test' + path, { method: 'POST', headers: who ? { authorization: 'Bearer tok-' + who } : {}, body: JSON.stringify(body || {}) });
const call = async (c, path, who, body) => (await c.route(req(path, who, body)));
const cbq = (code, state) => new Request('https://x.test/oauth/callback?code=' + code + '&state=' + encodeURIComponent(state));
const stateOf = (r) => new URL(r.body.url).searchParams.get('state');

reset();
let c = mk({});
let r = await call(c, '/creator/install', 'own', { cid: 'alpha-desk' });
ok(r.status === 503 && r.body.error === 'notready', 'no secrets -> "being set up" (503), nothing breaks');
r = await c.route(new Request('https://x.test/public?cid=alpha-desk'));
ok(r.body.ready === false && r.body.connected === false, 'public info says not ready');
ok((await c.sweep()).skipped, 'cron does nothing when not set up');

c = mk();
r = await call(c, '/creator/install', null, { cid: 'alpha-desk' });
ok(r.status === 401, 'signed-out -> 401');
r = await call(c, '/creator/install', 'u1', { cid: 'alpha-desk' });
ok(r.status === 403, 'non-owner cannot connect a server');
r = await call(c, '/creator/install', 'own', { cid: '../x' });
ok(r.status === 400, 'bad community id refused');
r = await call(c, '/creator/install', 'own', { cid: 'alpha-desk' });
const u = new URL(r.body.url);
ok(u.searchParams.get('scope') === 'bot' && u.searchParams.get('permissions') === '268435457' && BOT_PERMS === 0x10000000 + 1, 'bot link: scope bot, permissions Manage Roles + Create Instant Invite only');
ok(u.searchParams.get('redirect_uri') === 'https://x.test/oauth/callback', 'redirect uri');
const botState = stateOf(r);
let cb = await c.route(cbq('botcode', botState.replace(/.$/, 'x')));
ok(cb.redirect.includes('discord=expired'), 'tampered state refused');
r = await call(c, '/creator/install', 'own', { cid: 'alpha-desk' });
const st1 = stateOf(r);
cb = await c.route(cbq('botcode', st1));
ok(cb.redirect === 'https://tradezoro.com/creator?c=alpha-desk&tab=discord&discord=connected', 'bot callback -> creator hub connected');
cb = await c.route(cbq('botcode', st1));
ok(cb.redirect.includes('expired'), 'state is one-time');
r = await call(c, '/creator/roles', 'own', { cid: 'alpha-desk' });
ok(r.body.connected && r.body.guild.name === 'Alpha Server' && r.body.roles.length === 4, 'creator lists roles (without @everyone)');
const by = Object.fromEntries(r.body.roles.map((x) => [x.name, x.assignable]));
ok(by.Gold === true && by.Silver === true && by.Boss === false && by.TradeZoro === false, 'only roles below the bot (and not managed) are assignable');
r = await call(c, '/creator/roles', 'u1', { cid: 'alpha-desk' });
ok(r.status === 403, 'member cannot list roles');
setDoc('communities/beta-desk', { ownerUid: 'own', status: 'active' });
r = await call(c, '/creator/install', 'own', { cid: 'beta-desk' });
cb = await c.route(cbq('botcode', stateOf(r)));
ok(cb.redirect.includes('discord=taken'), 'one Discord server cannot be attached to two communities');

r = await call(c, '/link/start', 'u1', { cid: 'alpha-desk', refreshToken: 'fbr1' });
const lu = new URL(r.body.url);
ok(lu.searchParams.get('scope') === 'identify guilds.join', 'member link scopes: identify guilds.join only');
cb = await c.route(cbq('usercode', lu.searchParams.get('state')));
ok(cb.redirect === 'https://tradezoro.com/c/alpha-desk?discord=linked', 'user callback -> community page linked');
ok(W.guildMembers['7000000001'] && W.guildMembers['7000000001'].has('5000000003'), 'auto-join: member joined the server WITH the role for his plan (Gold)');
r = await call(c, '/me', 'u1', { cid: 'alpha-desk' });
ok(r.body.linked && r.body.username === 'Trader One' && r.body.state === 'active', '/me shows linked + active');
ok(!JSON.stringify(r.body).includes('ua1') && !JSON.stringify(r.body).includes('ur1') && !JSON.stringify(r.body).includes('fbr'), 'no token in any API answer');

setDoc('communities/alpha-desk/members/u1', { planId: 'p2', role: 'member', status: 'active', expiresAt: null });
let s = await c.sweep();
const roleSet = W.guildMembers['7000000001'];
ok(roleSet.has('5000000004') && !roleSet.has('5000000003'), 'plan changed Gold -> Silver: roles swapped by the 15 min check');
setDoc('communities/alpha-desk/members/u1', { planId: 'p3', role: 'member', status: 'active', expiresAt: null });
await c.sweep();
ok(!W.guildMembers['7000000001'].has('5000000004'), 'plan with no Discord role -> role removed');
setDoc('communities/alpha-desk/members/u1', { planId: 'p4', role: 'member', status: 'active', expiresAt: null });
await c.sweep();
ok(c.one('SELECT state FROM enroll WHERE uid=?', 'u1').state === 'badrole' && !W.guildMembers['7000000001'].has('5000000005'), 'role above the bot is never assigned (badrole)');
setDoc('communities/alpha-desk/members/u1', { planId: 'p1', role: 'member', status: 'active', expiresAt: new Date(W.now + 3600e3) });
await c.sweep();
ok(W.guildMembers['7000000001'].has('5000000003'), 'active until expiry: role present');
W.now += 2 * 3600e3; c.tokCache.clear();
s = await c.sweep();
ok(!W.guildMembers['7000000001'].has('5000000003') && s.removed === 1, 'membership expired -> role removed by the cron');
ok(c.one('SELECT state, note FROM enroll WHERE uid=?', 'u1').note === 'expired', 'state removed, reason expired');
setDoc('communities/alpha-desk/members/u1', { planId: 'p1', role: 'member', status: 'active', expiresAt: null });
await c.sweep();
ok(W.guildMembers['7000000001'].has('5000000003'), 'renewed membership -> role comes back');
setDoc('communities/alpha-desk/members/u1', { planId: 'p1', role: 'member', status: 'banned', expiresAt: null });
await c.sweep();
ok(!W.guildMembers['7000000001'].has('5000000003'), 'banned -> role removed');
setDoc('communities/alpha-desk/members/u1', { planId: 'p1', role: 'member', status: 'active', expiresAt: null }); await c.sweep();
delete W.fs['communities/alpha-desk/members/u1']; await c.sweep();
ok(!W.guildMembers['7000000001'].has('5000000003'), 'member doc deleted (left / removed) -> role removed');
setDoc('communities/alpha-desk/members/u1', { planId: 'p1', role: 'member', status: 'active', expiresAt: null }); await c.sweep();
setDoc('communities/alpha-desk', { ownerUid: 'own', status: 'suspended' }); await c.sweep();
ok(!W.guildMembers['7000000001'].has('5000000003'), 'suspended community -> roles removed');
setDoc('communities/alpha-desk', { ownerUid: 'own', status: 'active' });
await c.sweep(); ok(W.guildMembers['7000000001'].has('5000000003'), 're-added after un-suspend');
W.fbDead = 'TOKEN_EXPIRED'; c.tokCache.clear(); await c.sweep();
ok(W.guildMembers['7000000001'].has('5000000003') && c.one('SELECT state FROM enroll WHERE uid=?', 'u1').state === 'active', 'stale sign-in token: role kept (no false removals), note asks to open TradeZoro');
W.fbDead = 'USER_NOT_FOUND'; c.tokCache.clear(); await c.sweep();
ok(!W.guildMembers['7000000001'].has('5000000003'), 'account deleted -> role removed');
W.fbDead = null; c.tokCache.clear();
setDoc('communities/alpha-desk/members/u1', { planId: 'p1', role: 'member', status: 'active', expiresAt: null });
await call(c, '/sync', 'u1', { cid: 'alpha-desk' });
ok(W.guildMembers['7000000001'].has('5000000003'), 'member opening the page gets the role back at once (sync)');
setDoc('communities/alpha-desk/members/u1', { planId: 'p1', role: 'member', status: 'banned', expiresAt: null });
r = await call(c, '/creator/resync', 'own', { cid: 'alpha-desk' });
ok(r.body.changed === 1 && !W.guildMembers['7000000001'].has('5000000003'), 'creator "check everyone now" removes at once');
r = await call(c, '/creator/resync', 'u1', { cid: 'alpha-desk' });
ok(r.status === 403, 'resync is owner only');
await call(c, '/creator/settings', 'own', { cid: 'alpha-desk', autoJoin: false });
setDoc('communities/alpha-desk/members/u1', { planId: 'p1', role: 'member', status: 'active', expiresAt: null });
delete W.guildMembers['7000000001'];
r = await call(c, '/sync', 'u1', { cid: 'alpha-desk' });
ok(r.body.state === 'invite' && r.body.inviteUrl === 'https://discord.gg/abc123' && !W.guildMembers['7000000001'], 'auto-join off: gets a one-use invite, not force-joined');
W.guildMembers['7000000001'] = new Set();
r = await call(c, '/sync', 'u1', { cid: 'alpha-desk' });
ok(r.body.state === 'active' && W.guildMembers['7000000001'].has('5000000003'), 'after he joins by himself the role is added');
r = await call(c, '/link/start', 'u2', { cid: 'alpha-desk' });
cb = await c.route(cbq('usercode', stateOf(r)));
ok(cb.redirect.includes('discord=used'), 'same Discord account cannot be linked to two TradeZoro accounts');
r = await call(c, '/unlink', 'u1', {});
ok(r.body.unlinked && r.body.removed === 1 && !W.guildMembers['7000000001'].has('5000000003') && W.revoked === 1, 'unlink: role removed, OAuth token revoked');
ok(!c.one('SELECT 1 x FROM links WHERE uid=?', 'u1') && !c.one('SELECT 1 x FROM enroll WHERE uid=?', 'u1'), 'unlink: link + enrolment deleted');
r = await call(c, '/creator/disconnect', 'own', { cid: 'alpha-desk' });
ok(r.body.disconnected && !c.one('SELECT 1 x FROM guilds WHERE cid=?', 'alpha-desk'), 'creator can disconnect the server');
r = await c.route(new Request('https://x.test/public?cid=alpha-desk'));
ok(JSON.stringify(r.body) === '{"ready":true,"connected":false,"guildName":null,"autoJoin":null}', 'public info exposes nothing but name + flags');
console.log(fails ? '\n' + fails + ' FAILED' : '\nALL PASSED'); process.exit(fails ? 1 : 0);
