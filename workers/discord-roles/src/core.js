// TradeZoro Discord roles: all logic, no Cloudflare globals (so node can test it with a mock Discord/Firestore).
// Used by: src/index.js (Worker routes + 15 min cron), test/core.test.mjs.
//
// Privacy / trust model
//  - Discord tokens (bot token, member OAuth tokens) live ONLY here: env secrets + Durable Object SQLite. No
//    Firestore document ever holds them, so no client can read them.
//  - Membership truth is Firestore. This Worker has no service account. It reads the member's own doc with the
//    Firebase token of the person concerned (refresh token kept server-side, only for the cron), or with the
//    creator's token when the creator presses "Check everyone now". Firestore rules decide what can be read.
//  - Nothing here writes to Firestore.
import { verifyIdToken, RT_PROJECT } from './rt-auth.js';

const D = 'https://discord.com/api/v10';
const FS = 'https://firestore.googleapis.com/v1/projects/' + RT_PROJECT + '/databases/(default)/documents/';
export const BOT_PERMS = 268435457;          // Manage Roles (0x10000000) + Create Instant Invite (0x1)
const SCOPES_USER = 'identify guilds.join';
const SCHEMA = [
  'CREATE TABLE IF NOT EXISTS guilds(cid TEXT PRIMARY KEY, guild_id TEXT UNIQUE, name TEXT, auto_join INTEGER DEFAULT 1, owner_uid TEXT, created INTEGER)',
  'CREATE TABLE IF NOT EXISTS links(uid TEXT PRIMARY KEY, did TEXT, dname TEXT, access TEXT, refresh TEXT, exp INTEGER, fb_refresh TEXT, created INTEGER)',
  'CREATE TABLE IF NOT EXISTS enroll(cid TEXT, uid TEXT, role_id TEXT, state TEXT, in_guild INTEGER DEFAULT 0, checked INTEGER DEFAULT 0, note TEXT, PRIMARY KEY(cid, uid))',
  'CREATE TABLE IF NOT EXISTS pending(n TEXT PRIMARY KEY, kind TEXT, uid TEXT, cid TEXT, fb_refresh TEXT, exp INTEGER)',
];
export class HttpErr extends Error { constructor(status, code, msg) { super(msg || code); this.status = status; this.code = code; } }

const enc = new TextEncoder();
const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const rnd = () => b64u(crypto.getRandomValues(new Uint8Array(18)));
async function hmac(secret, msg) {
  const k = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64u(await crypto.subtle.sign('HMAC', k, enc.encode(msg)));
}
const CID_RE = /^[a-z0-9][a-z0-9-]{2,29}$/;
const ID_RE = /^\d{5,25}$/;

// Firestore REST value -> JS (only what we read)
function dec(f) {
  if (!f) return undefined;
  if ('stringValue' in f) return f.stringValue;
  if ('integerValue' in f) return Number(f.integerValue);
  if ('booleanValue' in f) return f.booleanValue;
  if ('timestampValue' in f) return new Date(f.timestampValue);
  if ('nullValue' in f) return null;
  if ('mapValue' in f) return Object.fromEntries(Object.entries(f.mapValue.fields || {}).map(([k, v]) => [k, dec(v)]));
  return undefined;
}
const decDoc = (d) => Object.fromEntries(Object.entries(d.fields || {}).map(([k, v]) => [k, dec(v)]));

export class Core {
  constructor(sql, env, opts = {}) {
    this.sql = sql; this.env = env || {};
    this.f = opts.fetchImpl || fetch; this.now = opts.now || (() => Date.now());
    this.verify = opts.verify || ((t) => verifyIdToken(t, { fetchImpl: this.f }));
    this.sleep = opts.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
    for (const s of SCHEMA) sql.exec(s);
    this.site = this.env.SITE_URL || 'https://tradezoro.com';
    this.self = this.env.PUBLIC_URL || 'https://discord-roles.theelitegrey.workers.dev';
    this.tokCache = new Map();
  }
  get ready() { return !!(this.env.DISCORD_BOT_TOKEN && this.env.DISCORD_CLIENT_ID && this.env.DISCORD_CLIENT_SECRET); }
  q(sql, ...a) { return [...this.sql.exec(sql, ...a)]; }
  one(sql, ...a) { return this.q(sql, ...a)[0] || null; }
  run(sql, ...a) { this.sql.exec(sql, ...a); }
  redirectUri() { return this.self + '/oauth/callback'; }

  // ---- Discord ------------------------------------------------------------------------------------------
  async dc(method, path, body, o = {}) {
    for (let i = 0; i < 3; i++) {
      const h = { authorization: o.bearer ? 'Bearer ' + o.bearer : 'Bot ' + this.env.DISCORD_BOT_TOKEN };
      if (o.reason) h['x-audit-log-reason'] = encodeURIComponent(o.reason).slice(0, 400);
      let b;
      if (body && o.form) { b = new URLSearchParams(body).toString(); h['content-type'] = 'application/x-www-form-urlencoded'; }
      else if (body) { b = JSON.stringify(body); h['content-type'] = 'application/json'; }
      const r = await this.f(D + path, { method, headers: h, body: b });
      if (r.status === 429 && i < 2) { let w = 1; try { w = (await r.json()).retry_after || 1; } catch (e) {} await this.sleep(Math.min(5, w) * 1000); continue; }
      let data = null; try { data = await r.json(); } catch (e) {}
      return { status: r.status, ok: r.ok, data };
    }
  }

  // ---- Firebase / Firestore -----------------------------------------------------------------------------
  async fbToken(uid) {
    const c = this.tokCache.get(uid); if (c && c.exp > this.now() + 60000) return c.t;
    const row = this.one('SELECT fb_refresh FROM links WHERE uid=?', uid);
    if (!row || !row.fb_refresh) return { dead: 'none' };
    const r = await this.f('https://securetoken.googleapis.com/v1/token?key=' + this.env.FB_API_KEY, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'grant_type=refresh_token&refresh_token=' + encodeURIComponent(row.fb_refresh) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      const m = (j.error && j.error.message) || '';
      const t = { dead: /USER_DISABLED|USER_NOT_FOUND/.test(m) ? 'gone' : 'stale' };
      return t;
    }
    if (j.refresh_token && j.refresh_token !== row.fb_refresh) this.run('UPDATE links SET fb_refresh=? WHERE uid=?', j.refresh_token, uid);
    const t = { id: j.id_token };
    this.tokCache.set(uid, { t, exp: this.now() + (Number(j.expires_in) || 3000) * 1000 });
    return t;
  }
  async fsGet(path, tok) {
    const r = await this.f(FS + path, { headers: { authorization: 'Bearer ' + tok } });
    if (r.status === 404) return null;
    if (r.status === 403) return { denied: true };
    if (!r.ok) throw new HttpErr(502, 'firestore', 'Could not read membership.');
    return decDoc(await r.json());
  }
  // -> { ok, roleId, why }  Is this person an active member RIGHT NOW, and which Discord role does his plan carry?
  async entitlement(tok, cid, uid) {
    const cm = await this.fsGet('communities/' + cid, tok);
    if (!cm || cm.denied) return { ok: false, why: 'nocommunity' };
    if (cm.status !== 'active') return { ok: false, why: 'suspended' };
    const m = await this.fsGet('communities/' + cid + '/members/' + uid, tok);
    if (!m || m.denied) return { ok: false, why: 'notmember' };
    if (m.status !== 'active') return { ok: false, why: m.status || 'inactive' };
    if (m.expiresAt && m.expiresAt.getTime() <= this.now()) return { ok: false, why: 'expired' };
    if (m.role === 'owner' && !m.planId) return { ok: true, roleId: null, why: 'owner' };
    const p = m.planId ? await this.fsGet('communities/' + cid + '/plans/' + m.planId, tok) : null;
    const rid = p && !p.denied && ID_RE.test(p.discordRoleId || '') ? p.discordRoleId : null;
    return { ok: true, roleId: rid, why: rid ? 'ok' : 'norole' };
  }

  // ---- guild helpers ------------------------------------------------------------------------------------
  async guildRoles(gid) {
    const r = await this.dc('GET', '/guilds/' + gid + '/roles');
    if (!r.ok) return null;
    return r.data;
  }
  async botTop(gid, roles) {
    const m = await this.dc('GET', '/guilds/' + gid + '/members/' + this.env.DISCORD_CLIENT_ID);
    if (!m.ok) return -1;
    return Math.max(0, ...(m.data.roles || []).map((id) => (roles.find((x) => x.id === id) || { position: 0 }).position));
  }
  async inviteFor(gid) {
    const g = await this.dc('GET', '/guilds/' + gid);
    let ch = g.ok && g.data.system_channel_id;
    if (!ch) { const c = await this.dc('GET', '/guilds/' + gid + '/channels'); const t = c.ok && (c.data || []).find((x) => x.type === 0); ch = t && t.id; }
    if (!ch) return null;
    const r = await this.dc('POST', '/channels/' + ch + '/invites', { max_age: 86400, max_uses: 1, unique: true });
    return r.ok ? 'https://discord.gg/' + r.data.code : null;
  }
  async userToken(link) {
    if (link.access && link.exp > this.now() + 60000) return link.access;
    if (!link.refresh) return null;
    const r = await this.dc('POST', '/oauth2/token', { client_id: this.env.DISCORD_CLIENT_ID, client_secret: this.env.DISCORD_CLIENT_SECRET, grant_type: 'refresh_token', refresh_token: link.refresh }, { form: true });
    if (!r.ok) return null;
    this.run('UPDATE links SET access=?, refresh=?, exp=? WHERE uid=?', r.data.access_token, r.data.refresh_token || link.refresh, this.now() + r.data.expires_in * 1000, link.uid);
    return r.data.access_token;
  }

  // ---- the one place that changes Discord ---------------------------------------------------------------
  // tok: Firebase ID token to read membership with ({id} or {dead}). Returns the enroll state.
  async apply(cid, uid, tok) {
    const e = this.one('SELECT * FROM enroll WHERE cid=? AND uid=?', cid, uid);
    const g = this.one('SELECT * FROM guilds WHERE cid=?', cid);
    const link = this.one('SELECT * FROM links WHERE uid=?', uid);
    if (!e) return { state: 'none' };
    const set = (state, note, extra = {}) => {
      const rid = 'role_id' in extra ? extra.role_id : e.role_id; const ig = 'in_guild' in extra ? extra.in_guild : e.in_guild;
      this.run('UPDATE enroll SET state=?, note=?, role_id=?, in_guild=?, checked=? WHERE cid=? AND uid=?', state, note || null, rid, ig, this.now(), cid, uid);
      return { state, note: note || null, ...(extra.inviteUrl ? { inviteUrl: extra.inviteUrl } : {}) };
    };
    if (!g || !link || !this.ready) return set(g ? 'waiting' : 'noserver', null);
    const reason = 'TradeZoro community ' + cid;
    const strip = async (why) => {
      if (e.role_id && link.did) { const d = await this.dc('DELETE', '/guilds/' + g.guild_id + '/members/' + link.did + '/roles/' + e.role_id, null, { reason: 'TradeZoro: ' + why }); if (!d.ok && d.status !== 404) return set('error', 'Could not remove the role. Will retry.'); }
      return set('removed', why, { role_id: null });
    };
    if (tok.dead === 'gone') return strip('account closed');
    if (tok.dead) return set(e.state === 'active' ? 'active' : 'stale', 'Open TradeZoro once to refresh the link.');
    const ent = await this.entitlement(tok.id, cid, uid);
    if (!ent.ok) return strip(ent.why);
    if (!ent.roleId) return e.role_id ? strip('plan has no Discord role') : set('norole', 'Your plan has no Discord role.');
    // role must still exist, be below the bot, not be managed / @everyone
    const roles = await this.guildRoles(g.guild_id);
    if (!roles) return set('error', 'The Discord server cannot be reached. The creator may need to reconnect it.');
    const role = roles.find((x) => x.id === ent.roleId);
    const top = await this.botTop(g.guild_id, roles);
    if (!role || role.managed || role.id === g.guild_id || role.position >= top) return set('badrole', 'The role for your plan is not available. Tell the creator.');
    if (e.role_id && e.role_id !== ent.roleId) await this.dc('DELETE', '/guilds/' + g.guild_id + '/members/' + link.did + '/roles/' + e.role_id, null, { reason });
    let inGuild = false;
    const m = await this.dc('GET', '/guilds/' + g.guild_id + '/members/' + link.did);
    if (m.ok) inGuild = true;
    else if (m.status === 404) {
      if (g.auto_join) {
        const at = await this.userToken(link);
        if (!at) return set('stale', 'Link Discord again to join the server.');
        const j = await this.dc('PUT', '/guilds/' + g.guild_id + '/members/' + link.did, { access_token: at, roles: [ent.roleId] }, { reason });
        if (j.status === 201 || j.status === 204) { return set('active', null, { role_id: ent.roleId, in_guild: 1 }); }
        if (j.status === 403 && j.data && j.data.code === 40007) return set('banned', 'You are banned from that Discord server.');
        return set('error', 'Could not add you to the server. Try again later.');
      }
      const inv = await this.inviteFor(g.guild_id);
      return set('invite', 'Join the server with the invite, then your role is added automatically.', { in_guild: 0, inviteUrl: inv });
    } else return set('error', 'Discord did not answer. Will retry.');
    const has = (m.data.roles || []).includes(ent.roleId);
    if (!has) {
      const a = await this.dc('PUT', '/guilds/' + g.guild_id + '/members/' + link.did + '/roles/' + ent.roleId, null, { reason });
      if (!a.ok) return set('error', 'Could not give the role. Will retry.');
    }
    return set('active', null, { role_id: ent.roleId, in_guild: 1 });
  }

  // ---- auth ---------------------------------------------------------------------------------------------
  async who(req) {
    const h = req.headers.get('authorization') || '';
    const token = h.startsWith('Bearer ') ? h.slice(7) : '';
    const uid = token ? await this.verify(token) : null;
    if (!uid) throw new HttpErr(401, 'signin', 'Sign in first.');
    return { uid, token };
  }
  async ownerOf(cid, who) {
    if (!CID_RE.test(cid || '')) throw new HttpErr(400, 'bad', 'Bad request.');
    const cm = await this.fsGet('communities/' + cid, who.token);
    if (!cm || cm.denied) throw new HttpErr(404, 'nocommunity', 'Community not found.');
    if (cm.ownerUid !== who.uid) throw new HttpErr(403, 'owner', 'Only the community owner can do this.');
    return cm;
  }
  async state(kind, uid, cid, fb) {
    const n = rnd(); const exp = this.now() + 15 * 60000;
    this.run('DELETE FROM pending WHERE exp < ?', this.now());
    this.run('INSERT INTO pending(n, kind, uid, cid, fb_refresh, exp) VALUES(?,?,?,?,?,?)', n, kind, uid, cid || '', fb || null, exp);
    return n + '.' + (await hmac(this.env.DISCORD_CLIENT_SECRET, n + '|' + kind + '|' + uid)).slice(0, 22);
  }
  async takeState(s, kind) {
    const [n, sig] = String(s || '').split('.');
    const p = n && this.one('SELECT * FROM pending WHERE n=?', n);
    if (!p) return null;
    this.run('DELETE FROM pending WHERE n=?', n);
    if (p.kind !== kind || p.exp < this.now()) return null;
    if ((await hmac(this.env.DISCORD_CLIENT_SECRET, n + '|' + kind + '|' + p.uid)).slice(0, 22) !== sig) return null;
    return p;
  }
  authUrl(kind, state) {
    const base = 'https://discord.com/oauth2/authorize?client_id=' + this.env.DISCORD_CLIENT_ID + '&response_type=code&redirect_uri=' + encodeURIComponent(this.redirectUri()) + '&state=' + encodeURIComponent(state);
    return kind === 'bot' ? base + '&scope=bot&permissions=' + BOT_PERMS : base + '&scope=' + encodeURIComponent(SCOPES_USER) + '&prompt=consent';
  }

  // ---- actions (JSON in -> JSON out) --------------------------------------------------------------------
  publicInfo(cid) {
    const g = CID_RE.test(cid || '') ? this.one('SELECT name, auto_join FROM guilds WHERE cid=?', cid) : null;
    return { ready: this.ready, connected: !!g, guildName: g ? g.name : null, autoJoin: g ? !!g.auto_join : null };
  }
  async me(who, body) {
    const link = this.one('SELECT dname FROM links WHERE uid=?', who.uid);
    const out = { ...this.publicInfo(body.cid), linked: !!link, username: link ? link.dname : null };
    if (CID_RE.test(body.cid || '')) { const e = this.one('SELECT state, note FROM enroll WHERE cid=? AND uid=?', body.cid, who.uid); out.state = e ? e.state : null; out.note = e ? e.note : null; }
    return out;
  }
  async creatorInstall(who, body) {
    if (!this.ready) throw new HttpErr(503, 'notready', 'Discord connection is being set up.');
    await this.ownerOf(body.cid, who);
    return { url: this.authUrl('bot', await this.state('bot', who.uid, body.cid)) };
  }
  async creatorRoles(who, body) {
    await this.ownerOf(body.cid, who);
    const g = this.one('SELECT * FROM guilds WHERE cid=?', body.cid);
    if (!g) return { connected: false };
    const roles = await this.guildRoles(g.guild_id);
    if (!roles) return { connected: true, guild: { name: g.name, autoJoin: !!g.auto_join }, error: 'The bot cannot reach this server. Reconnect it.', roles: [] };
    const top = await this.botTop(g.guild_id, roles);
    return { connected: true, guild: { name: g.name, autoJoin: !!g.auto_join }, botTop: top,
      roles: roles.filter((r) => r.id !== g.guild_id).sort((a, b) => b.position - a.position).map((r) => ({ id: r.id, name: r.name, color: r.color, assignable: !r.managed && r.position < top })) };
  }
  async creatorSettings(who, body) {
    await this.ownerOf(body.cid, who);
    if (!this.one('SELECT 1 x FROM guilds WHERE cid=?', body.cid)) throw new HttpErr(404, 'noserver', 'Connect a Discord server first.');
    this.run('UPDATE guilds SET auto_join=? WHERE cid=?', body.autoJoin ? 1 : 0, body.cid);
    return { autoJoin: !!body.autoJoin };
  }
  async creatorDisconnect(who, body) {
    await this.ownerOf(body.cid, who);
    const g = this.one('SELECT * FROM guilds WHERE cid=?', body.cid); if (!g) return { disconnected: true };
    let stripped = 0;
    for (const e of this.q('SELECT e.uid, e.role_id, l.did FROM enroll e LEFT JOIN links l ON l.uid=e.uid WHERE e.cid=?', body.cid)) {
      if (e.role_id && e.did) { const r = await this.dc('DELETE', '/guilds/' + g.guild_id + '/members/' + e.did + '/roles/' + e.role_id, null, { reason: 'TradeZoro: server disconnected' }); if (r.ok) stripped++; }
    }
    this.run('DELETE FROM enroll WHERE cid=?', body.cid); this.run('DELETE FROM guilds WHERE cid=?', body.cid);
    return { disconnected: true, stripped };
  }
  // The creator asks for everyone to be re-checked now (after a ban, removal, expiry or plan change). Uses HIS token to read.
  async creatorResync(who, body) {
    await this.ownerOf(body.cid, who);
    const rows = this.q('SELECT uid FROM enroll WHERE cid=? LIMIT 200', body.cid);
    const c = { changed: 0, checked: 0 };
    for (const r of rows) { const a = await this.apply(body.cid, r.uid, { id: who.token }); c.checked++; if (a.state === 'removed') c.changed++; }
    return c;
  }
  async linkStart(who, body) {
    if (!this.ready) throw new HttpErr(503, 'notready', 'Discord connection is being set up.');
    const cid = CID_RE.test(body.cid || '') ? body.cid : '';
    if (cid && !this.one('SELECT 1 x FROM guilds WHERE cid=?', cid)) throw new HttpErr(404, 'noserver', 'This community has no Discord server connected.');
    const fb = typeof body.refreshToken === 'string' && body.refreshToken.length < 2000 ? body.refreshToken : null;
    return { url: this.authUrl('user', await this.state('user', who.uid, cid, fb)) };
  }
  // Member opened the community page / pressed "Check": create the enrolment if he is a member and apply now.
  async sync(who, body) {
    const cid = body.cid; if (!CID_RE.test(cid || '')) throw new HttpErr(400, 'bad', 'Bad request.');
    const link = this.one('SELECT uid FROM links WHERE uid=?', who.uid);
    if (!link) return { linked: false, state: null };
    if (typeof body.refreshToken === 'string' && body.refreshToken.length < 2000) { this.run('UPDATE links SET fb_refresh=? WHERE uid=?', body.refreshToken, who.uid); this.tokCache.delete(who.uid); }
    if (!this.one('SELECT 1 x FROM guilds WHERE cid=?', cid)) return { linked: true, state: 'noserver' };
    if (!this.one('SELECT 1 x FROM enroll WHERE cid=? AND uid=?', cid, who.uid)) this.run('INSERT INTO enroll(cid, uid, state) VALUES(?,?,?)', cid, who.uid, 'new');
    const r = await this.apply(cid, who.uid, { id: who.token });
    if (r.state === 'removed' || r.state === 'noserver') { /* keep row so a later plan change can add him back on his next visit */ }
    return { linked: true, ...r };
  }
  async unlink(who) {
    const link = this.one('SELECT * FROM links WHERE uid=?', who.uid);
    let removed = 0;
    for (const e of this.q('SELECT e.cid, e.role_id, g.guild_id FROM enroll e JOIN guilds g ON g.cid=e.cid WHERE e.uid=?', who.uid)) {
      if (e.role_id && link) { const r = await this.dc('DELETE', '/guilds/' + e.guild_id + '/members/' + link.did + '/roles/' + e.role_id, null, { reason: 'TradeZoro: member unlinked Discord' }); if (r.ok || r.status === 404) removed++; }
    }
    if (link && link.access) await this.dc('POST', '/oauth2/token/revoke', { client_id: this.env.DISCORD_CLIENT_ID, client_secret: this.env.DISCORD_CLIENT_SECRET, token: link.access }, { form: true }).catch(() => {});
    this.run('DELETE FROM enroll WHERE uid=?', who.uid); this.run('DELETE FROM links WHERE uid=?', who.uid);
    return { unlinked: true, removed };
  }

  // ---- OAuth return -------------------------------------------------------------------------------------
  // -> redirect target on the site. Never shows tokens or codes.
  async callback(url) {
    const code = url.searchParams.get('code'), st = url.searchParams.get('state') || '';
    if (!this.ready) return this.site + '/communities?discord=notready';
    const peek = this.one('SELECT kind, cid FROM pending WHERE n=?', st.split('.')[0]);
    const k = peek ? peek.kind : null;
    const hubBack = (cid, s) => this.site + '/creator?c=' + cid + '&tab=discord&discord=' + s;
    const comBack = (cid, s) => this.site + (cid ? '/c/' + cid : '/communities') + (cid ? '?' : '?') + 'discord=' + s;
    const p = k ? await this.takeState(st, k) : null;
    if (!p) return this.site + '/communities?discord=expired';
    if (url.searchParams.get('error') || !code) return k === 'bot' ? hubBack(p.cid, 'cancelled') : comBack(p.cid || '', 'cancelled');
    const tk = await this.dc('POST', '/oauth2/token', { client_id: this.env.DISCORD_CLIENT_ID, client_secret: this.env.DISCORD_CLIENT_SECRET, grant_type: 'authorization_code', code, redirect_uri: this.redirectUri() }, { form: true });
    if (!tk.ok) return k === 'bot' ? hubBack(p.cid, 'failed') : comBack(p.cid || '', 'failed');
    if (k === 'bot') {
      const gu = tk.data.guild;
      if (!gu || !gu.id) return hubBack(p.cid, 'noguild');
      const taken = this.one('SELECT cid FROM guilds WHERE guild_id=? AND cid<>?', gu.id, p.cid);
      if (taken) return hubBack(p.cid, 'taken');
      this.run('INSERT INTO guilds(cid, guild_id, name, auto_join, owner_uid, created) VALUES(?,?,?,1,?,?) ON CONFLICT(cid) DO UPDATE SET guild_id=excluded.guild_id, name=excluded.name', p.cid, gu.id, String(gu.name || 'Discord server').slice(0, 100), p.uid, this.now());
      return hubBack(p.cid, 'connected');
    }
    const me = await this.dc('GET', '/users/@me', null, { bearer: tk.data.access_token });
    if (!me.ok || !me.data.id) return comBack(p.cid, 'failed');
    const did = me.data.id, dn = String(me.data.global_name || me.data.username || 'Discord user').slice(0, 60);
    const other = this.one('SELECT uid FROM links WHERE did=? AND uid<>?', did, p.uid);
    if (other) return comBack(p.cid, 'used');
    this.run('INSERT INTO links(uid, did, dname, access, refresh, exp, fb_refresh, created) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(uid) DO UPDATE SET did=excluded.did, dname=excluded.dname, access=excluded.access, refresh=excluded.refresh, exp=excluded.exp, fb_refresh=COALESCE(excluded.fb_refresh, fb_refresh)',
      p.uid, did, dn, tk.data.access_token, tk.data.refresh_token, this.now() + tk.data.expires_in * 1000, p.fb_refresh, this.now());
    this.tokCache.delete(p.uid);
    if (p.cid && this.one('SELECT 1 x FROM guilds WHERE cid=?', p.cid)) {
      if (!this.one('SELECT 1 x FROM enroll WHERE cid=? AND uid=?', p.cid, p.uid)) this.run('INSERT INTO enroll(cid, uid, state) VALUES(?,?,?)', p.cid, p.uid, 'new');
      const t = await this.fbToken(p.uid);
      await this.apply(p.cid, p.uid, t);
    }
    return comBack(p.cid || '', 'linked');
  }

  // ---- cron: every 15 min -------------------------------------------------------------------------------
  async sweep(limit = 150) {
    if (!this.ready) return { skipped: 'not set up' };
    const rows = this.q('SELECT cid, uid FROM enroll ORDER BY checked ASC LIMIT ?', limit);
    const out = { checked: 0, removed: 0, errors: 0 };
    for (const r of rows) {
      try {
        const t = await this.fbToken(r.uid);
        const a = await this.apply(r.cid, r.uid, t);
        out.checked++; if (a.state === 'removed') out.removed++; if (a.state === 'error') out.errors++;
      } catch (e) { out.errors++; this.run('UPDATE enroll SET checked=? WHERE cid=? AND uid=?', this.now(), r.cid, r.uid); }
    }
    return out;
  }

  // ---- router -------------------------------------------------------------------------------------------
  async route(req) {
    const url = new URL(req.url), path = url.pathname;
    if (req.method === 'OPTIONS') return { status: 204, body: null };
    if (path === '/ready' && req.method === 'GET') return { status: 200, body: { ready: this.ready } };
    if (path === '/public' && req.method === 'GET') return { status: 200, body: this.publicInfo(url.searchParams.get('cid')) };
    if (path === '/oauth/callback' && req.method === 'GET') return { redirect: await this.callback(url) };
    if (req.method !== 'POST') return { status: 404, body: { ok: false, error: 'unknown' } };
    const acts = { '/me': this.me, '/creator/install': this.creatorInstall, '/creator/roles': this.creatorRoles, '/creator/settings': this.creatorSettings,
      '/creator/disconnect': this.creatorDisconnect, '/creator/resync': this.creatorResync, '/link/start': this.linkStart, '/sync': this.sync, '/unlink': this.unlink };
    const fn = Object.prototype.hasOwnProperty.call(acts, path) ? acts[path] : null;
    if (!fn) return { status: 404, body: { ok: false, error: 'unknown' } };
    try {
      const who = await this.who(req);
      let body = {}; try { body = await req.json(); } catch (e) {}
      if (!body || typeof body !== 'object') body = {};
      return { status: 200, body: { ok: true, ...(await fn.call(this, who, body)) } };
    } catch (e) {
      if (e instanceof HttpErr) return { status: e.status, body: { ok: false, error: e.code, message: e.message } };
      return { status: 500, body: { ok: false, error: 'server', message: 'Something went wrong. Try again.' } };
    }
  }
}
