// Discord interactions: tap-to-toggle self-role buttons (custom_id "tzrole:<roleId>"). Stateless; caches live per isolate.
import { handleTicket } from './tickets.js';
const D = 'https://discord.com/api/v10';
export const GUILD = '1565740274116857887';
export const MARKETS = ['Futures', 'Stocks', 'Crypto', 'Forex', 'India', 'Options'];
export const LEVELS = ['Beginner', 'Intermediate', 'Advanced'];
let keyCache = null, roleCache = null;
export const resetCache = () => { keyCache = null; roleCache = null; };
const hex = (s) => Uint8Array.from(s.match(/../g) || [], (h) => parseInt(h, 16));
const reply = (content) => Response.json({ type: 4, data: { content, flags: 64 } });
const bot = (env) => ({ authorization: 'Bot ' + env.DISCORD_BOT_TOKEN, 'content-type': 'application/json', 'x-audit-log-reason': 'TradeZoro self-role button' });

async function publicKey(env, f) {
  if (env.DISCORD_PUBLIC_KEY) return env.DISCORD_PUBLIC_KEY;
  if (keyCache) return keyCache;
  const r = await f(D + '/applications/@me', { headers: bot(env) });
  if (!r.ok) return null;
  keyCache = (await r.json()).verify_key || null; return keyCache;
}
async function verified(req, body, env, f) {
  try {
    const sig = req.headers.get('x-signature-ed25519'), ts = req.headers.get('x-signature-timestamp'), pk = await publicKey(env, f);
    if (!sig || !ts || !pk) return false;
    const key = await crypto.subtle.importKey('raw', hex(pk), { name: 'Ed25519' }, false, ['verify']);
    return await crypto.subtle.verify('Ed25519', key, hex(sig), new TextEncoder().encode(ts + body));
  } catch (e) { return false; }
}
// name -> id for the 9 self-roles, from the guild role list (never trusts the button's id on its own)
async function allowed(env, f) {
  if (roleCache) return roleCache;
  const r = await f(D + '/guilds/' + GUILD + '/roles', { headers: bot(env) });
  if (!r.ok) return null;
  const m = {};
  for (const x of await r.json()) if ([...MARKETS, ...LEVELS].includes(x.name) && !x.managed && !(BigInt(x.permissions || '0') & 8n)) m[x.id] = x.name;
  roleCache = m; return m;
}

export async function handleInteraction(req, env, f = (...a) => fetch(...a), ctx) {
  const raw = await req.text();
  if (!(await verified(req, raw, env, f))) return new Response('bad signature', { status: 401 });
  let i; try { i = JSON.parse(raw); } catch (e) { return new Response('bad', { status: 400 }); }
  if (i.type === 1) return Response.json({ type: 1 });
  if (i.type === 3 && /^tzticket:(open|close)$/.test((i.data && i.data.custom_id) || '')) return handleTicket(i, env, f, ctx);
  const id = i.type === 3 && i.data && /^tzrole:(\d{5,25})$/.exec(i.data.custom_id || '');
  if (!id) return reply('Unknown action.');
  if (i.guild_id !== GUILD) return reply('Not available here.');
  const uid = i.member && i.member.user && i.member.user.id;
  if (!uid || !/^\d+$/.test(uid)) return reply('Not available here.');
  const roles = await allowed(env, f);
  if (!roles) return reply('Try again in a moment.');
  const name = roles[id[1]];
  if (!name) return reply('That role cannot be picked.');
  const url = (r) => D + '/guilds/' + GUILD + '/members/' + uid + '/roles/' + r;
  const has = (i.member.roles || []).includes(id[1]);
  try {
    const res = await f(url(id[1]), { method: has ? 'DELETE' : 'PUT', headers: bot(env) });
    if (!res.ok) return reply('Could not update your role. Try again.');
    if (!has && LEVELS.includes(name)) // level is single-choice
      for (const [rid, n] of Object.entries(roles)) if (LEVELS.includes(n) && rid !== id[1] && (i.member.roles || []).includes(rid)) await f(url(rid), { method: 'DELETE', headers: bot(env) });
  } catch (e) { return reply('Could not update your role. Try again.'); }
  return reply(has ? 'Removed ' + name : '✅ Added ' + name);
}
