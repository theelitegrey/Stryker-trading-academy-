// Auto-ban for the scam AutoMod rule. Every minute: read new AutoMod alerts (type 24) in #mod-log, ban the offender.
// dc(method, path, body, {reason}) is Core.dc (handles 429 retry_after, never logs the token).
export const RULE = 'TradeZoro: scammers (auto timeout)';
const ADMIN = 8n, BAN = 4n;
const STAFF = ADMIN | BAN | 2n | 0x20n | 0x10000000n | 0x4000000000n; // admin, ban, kick, manage guild, manage roles, timeout
let running = false; // shortcut: per-isolate guard against overlapping runs, upgrade to a DB lease if the DO ever spans isolates
const gt = (a, b) => BigInt(a) > BigInt(b);

export async function runAutoban(sql, dc, gid, log = console.log) {
  if (running) return { skipped: 'already running' };
  running = true;
  try { return await run(sql, dc, gid, log); } finally { running = false; }
}

async function run(sql, dc, gid, log) {
  sql.exec('CREATE TABLE IF NOT EXISTS autoban(k TEXT PRIMARY KEY, v TEXT)');
  sql.exec('CREATE TABLE IF NOT EXISTS autoban_done(uid TEXT PRIMARY KEY, at INTEGER)');
  const get = (k) => { const r = [...sql.exec('SELECT v FROM autoban WHERE k=?', k)][0]; return r ? r.v : null; };
  const set = (k, v) => sql.exec('INSERT OR REPLACE INTO autoban(k,v) VALUES(?,?)', k, v);
  let ch = get('channel');
  if (!ch) {
    const c = await dc('GET', '/guilds/' + gid + '/channels');
    const f = c.ok && (c.data || []).find((x) => x.type === 0 && /(^|[^a-z0-9])mod-log$/i.test(String(x.name).replace(/^[^a-z0-9]+/i, '')));
    if (!f) return { skipped: 'no mod-log channel' };
    ch = f.id; set('channel', ch);
  }
  let last = get('last');
  if (!last) { // first run: start from the newest message, never act on history
    const r = await dc('GET', '/channels/' + ch + '/messages?limit=1');
    if (!r.ok) return { skipped: 'first run read failed ' + r.status };
    set('last', r.data && r.data[0] ? r.data[0].id : '1');
    return { initialised: true };
  }
  let ctx = null, banned = 0, pages = 0;
  while (pages++ < 5) {
    const r = await dc('GET', '/channels/' + ch + '/messages?limit=100&after=' + last);
    if (!r.ok) { if (r.status === 404) sql.exec("DELETE FROM autoban WHERE k='channel'"); return { error: r.status, banned }; }
    const msgs = (r.data || []).slice().sort((a, b) => (gt(a.id, b.id) ? 1 : -1));
    if (!msgs.length) break;
    for (const m of msgs) {
      const isHit = m.type === 24 && (m.embeds || []).some((e) => (e.fields || []).some((f) => f.name === 'rule_name' && f.value === RULE));
      const uid = m.author && m.author.id;
      if (isHit && uid && !m.author.bot && ![...sql.exec('SELECT 1 FROM autoban_done WHERE uid=?', uid)].length) {
        ctx = ctx || await loadCtx(dc, gid);
        if (!ctx) return { error: 'guild read failed', banned }; // retry next minute, last id not advanced
        const res = await handle(sql, dc, gid, ch, uid, ctx, log);
        if (res === 'retry') return { error: 'ban failed, will retry', banned };
        if (res === 'banned') banned++;
      }
      last = m.id; set('last', last);
    }
    if (msgs.length < 100) break;
  }
  return { banned };
}

async function loadCtx(dc, gid) {
  const [g, r] = await Promise.all([dc('GET', '/guilds/' + gid), dc('GET', '/guilds/' + gid + '/roles')]);
  if (!g.ok || !r.ok) return null;
  const priv = new Set((r.data || []).filter((x) => (BigInt(x.permissions || 0) & STAFF) || /^(admin|administrator|moderator|moderators|mod|mods|staff|owner)$/i.test(x.name)).map((x) => x.id));
  return { owner: g.data.owner_id, priv };
}

async function handle(sql, dc, gid, ch, uid, ctx, log) {
  const done = () => sql.exec('INSERT OR REPLACE INTO autoban_done(uid,at) VALUES(?,?)', uid, Date.now());
  if (uid === ctx.owner) return 'skip';
  const m = await dc('GET', '/guilds/' + gid + '/members/' + uid);
  if (m.ok && (m.data.user && m.data.user.bot || (m.data.roles || []).some((r) => ctx.priv.has(r)))) return 'skip';
  if (!m.ok && m.status !== 404) return 'retry'; // cannot prove they are not staff: do not ban blind
  const b = await dc('PUT', '/guilds/' + gid + '/bans/' + uid, { delete_message_seconds: 604800 }, { reason: 'Auto-ban: scam rule' });
  if (!b.ok) { if (b.status >= 500 || b.status === 429) return 'retry'; log('autoban: ban refused ' + b.status); return 'skip'; }
  done();
  try { await dc('POST', '/channels/' + ch + '/messages', { content: '🔨 Auto-banned <@' + uid + '> (scam rule). Unban: Server Settings → Bans.', allowed_mentions: { parse: [] } }); } catch (e) { log('autoban: announce failed'); }
  return 'banned';
}
