// Private support tickets: "tzticket:open" makes a private channel for member + staff, "tzticket:close" transcripts it to #mod-log and deletes it.
// Stateless except the 3/day limit (Durable Object env.HUB, path /__ticket). The opener's id lives in the channel topic.
const D = 'https://discord.com/api/v10';
const GUILD = '1565740274116857887', ADMIN = '1567407734708506645', MOD = '1567407735878975539';
const VIEW = 1024n, SEND = 2048n, HIST = 65536n, FILES = 32768n, MANAGE = 8192n;
const MEMBER_ALLOW = String(VIEW | SEND | HIST | FILES), STAFF_ALLOW = String(VIEW | SEND | HIST | FILES | MANAGE);
const strip = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9-]/g, '');
const hdr = (env, json = true) => ({ authorization: 'Bot ' + env.DISCORD_BOT_TOKEN, ...(json ? { 'content-type': 'application/json' } : {}), 'x-audit-log-reason': 'TradeZoro support ticket' });
const reply = (content) => Response.json({ type: 4, data: { content, flags: 64, allowed_mentions: { parse: [] } } });
const jget = async (f, env, path) => { const r = await f(D + path, { headers: hdr(env) }); return r.ok ? r.json() : null; };

export const ticketRow = (open) => ({ type: 1, components: [open
  ? { type: 2, style: 3, label: 'Open a ticket', emoji: { name: '🎫' }, custom_id: 'tzticket:open' }
  : { type: 2, style: 4, label: 'Close ticket', emoji: { name: '🔒' }, custom_id: 'tzticket:close' }] });

async function category(f, env, chans) {
  const have = chans.find((c) => c.type === 4 && strip(c.name) === 'tickets');
  if (have) return have.id;
  const r = await f(D + '/guilds/' + GUILD + '/channels', { method: 'POST', headers: hdr(env), body: JSON.stringify({ name: '🎫 TICKETS', type: 4, permission_overwrites: [
    { id: GUILD, type: 0, allow: '0', deny: String(VIEW) }, { id: ADMIN, type: 0, allow: STAFF_ALLOW, deny: '0' }, { id: MOD, type: 0, allow: STAFF_ALLOW, deny: '0' }] }) });
  return r.ok ? (await r.json()).id : null;
}

async function open(i, env, f) {
  const u = i.member.user, uid = u.id;
  const chans = await jget(f, env, '/guilds/' + GUILD + '/channels');
  if (!chans) return reply('Try again in a moment.');
  const mine = chans.find((c) => c.type === 0 && c.topic === 'tzticket:' + uid);
  if (mine) return reply('You already have an open ticket: <#' + mine.id + '>');
  // shortcut: limit counted in the Durable Object, fails open if it is unreachable; upgrade if abuse shows up
  try { if (env.HUB) { const s = env.HUB.get(env.HUB.idFromName('main')); const r = await s.fetch('https://hub/__ticket?uid=' + uid); if (r.status === 429) return reply('You have reached the limit of 3 tickets per day. Please use the support channel or support@tradezoro.com.'); } } catch (e) { /* fail open */ }
  const parent = await category(f, env, chans);
  if (!parent) return reply('Could not create your ticket. Try again.');
  const name = 'ticket-' + (strip(u.username).slice(0, 20) || 'member') + '-' + String(Math.floor(Math.random() * 10000)).padStart(4, '0');
  const bot = i.application_id;
  const ow = [{ id: GUILD, type: 0, allow: '0', deny: String(VIEW) }, { id: uid, type: 1, allow: MEMBER_ALLOW, deny: '0' },
    { id: ADMIN, type: 0, allow: STAFF_ALLOW, deny: '0' }, { id: MOD, type: 0, allow: STAFF_ALLOW, deny: '0' }];
  if (bot) ow.push({ id: bot, type: 1, allow: STAFF_ALLOW, deny: '0' });
  const r = await f(D + '/guilds/' + GUILD + '/channels', { method: 'POST', headers: hdr(env), body: JSON.stringify({ name, type: 0, parent_id: parent, topic: 'tzticket:' + uid, permission_overwrites: ow }) });
  if (!r.ok) return reply('Could not create your ticket. Try again.');
  const ch = await r.json();
  await f(D + '/channels/' + ch.id + '/messages', { method: 'POST', headers: hdr(env), body: JSON.stringify({
    content: 'Hi <@' + uid + '>, thanks for reaching out. <@&' + MOD + '> will be with you soon.\n\nPlease tell us what is wrong. If it is an account issue, include the email you use on TradeZoro.\n**Never share your password or card numbers here.** Billing and refund questions can also go to support@tradezoro.com.',
    allowed_mentions: { parse: [], users: [uid], roles: [MOD] }, components: [ticketRow(false)] }) });
  return reply('✅ Your private ticket is ready: <#' + ch.id + '>');
}

async function transcript(f, env, id) {
  const m = await jget(f, env, '/channels/' + id + '/messages?limit=100');
  if (!m) return null;
  return m.reverse().map((x) => '[' + x.timestamp + '] ' + (x.author && x.author.username) + ': ' + (x.content || '') + (x.attachments || []).map((a) => ' [file ' + a.filename + ']').join('')).join('\n') || '(empty)';
}

async function finish(i, env, f, ch, by) {
  const id = i.channel_id;
  await f(D + '/channels/' + id + '/messages', { method: 'POST', headers: hdr(env), body: JSON.stringify({ content: '🔒 Closed by ' + by, allowed_mentions: { parse: [] } }) });
  const log = (await jget(f, env, '/guilds/' + GUILD + '/channels') || []).find((c) => c.type === 0 && strip(c.name) === 'mod-log');
  const text = await transcript(f, env, id);
  let saved = false;
  if (log && text !== null) {
    const fd = new FormData();
    fd.append('payload_json', JSON.stringify({ content: 'Ticket **' + ch.name + '** (opener <@' + ch.topic.slice(9) + '>) closed by ' + by, allowed_mentions: { parse: [] } }));
    fd.append('files[0]', new Blob([text], { type: 'text/plain' }), ch.name + '.txt');
    saved = (await f(D + '/channels/' + log.id + '/messages', { method: 'POST', headers: hdr(env, false), body: fd })).ok;
  }
  if (!saved) { // never delete a ticket without its transcript
    await f(D + '/channels/' + id + '/messages', { method: 'POST', headers: hdr(env), body: JSON.stringify({ content: 'Transcript could not be saved, so this channel was kept. A moderator will remove it.' }) });
    return;
  }
  await new Promise((r) => setTimeout(r, env.TICKET_DELAY_MS === undefined ? 5000 : Number(env.TICKET_DELAY_MS)));
  await f(D + '/channels/' + id, { method: 'DELETE', headers: hdr(env) });
}

async function close(i, env, f, ctx) {
  const ch = await jget(f, env, '/channels/' + i.channel_id);
  if (!ch || ch.guild_id !== GUILD || !/^tzticket:\d+$/.test(ch.topic || '')) return reply('This is not a ticket channel.');
  const u = i.member.user, staff = (i.member.roles || []).some((r) => r === ADMIN || r === MOD);
  if (!staff && ch.topic !== 'tzticket:' + u.id) return reply('Only the ticket opener or staff can close this ticket.');
  const job = finish(i, env, f, ch, u.global_name || u.username).catch(() => {});
  if (ctx && ctx.waitUntil) ctx.waitUntil(job); else await job;
  return Response.json({ type: 6 }); // silent ack, no extra message to the member
}

export async function handleTicket(i, env, f, ctx) {
  if (i.guild_id !== GUILD) return reply('Not available here.');
  if (!i.member || !i.member.user || !/^\d+$/.test(i.member.user.id)) return reply('Not available here.');
  try { return i.data.custom_id === 'tzticket:open' ? await open(i, env, f) : await close(i, env, f, ctx); } catch (e) { return reply('Something went wrong. Try again.'); }
}
