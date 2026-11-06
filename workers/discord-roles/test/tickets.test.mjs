// node workers/discord-roles/test/tickets.test.mjs
import { handleInteraction, GUILD } from '../src/buttons.js';
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const kp = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']);
const toHex = (b) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
const pub = toHex(await crypto.subtle.exportKey('raw', kp.publicKey));
const MOD = '1567407735878975539', ADMIN = '1567407734708506645';
let chans, calls, n;
const reset = () => { n = 100; calls = []; chans = [{ id: '5', type: 0, name: '📋・mod-log', parent_id: '9' }]; };
const f = async (url, o = {}) => {
  url = String(url).split('/v10')[1]; const m = o.method || 'GET'; calls.push(m + ' ' + url);
  const body = typeof o.body === 'string' ? JSON.parse(o.body) : o.body;
  if (m === 'GET' && url === '/guilds/' + GUILD + '/channels') return Response.json(chans);
  if (m === 'POST' && url === '/guilds/' + GUILD + '/channels') { const c = { id: String(++n), ...body }; chans.push(c); return Response.json(c); }
  if (m === 'GET' && /^\/channels\/\d+$/.test(url)) return Response.json({ guild_id: GUILD, ...chans.find((c) => '/channels/' + c.id === url) });
  if (m === 'GET' && url.includes('/messages')) return Response.json([{ timestamp: 't2', author: { username: 'mod' }, content: 'b' }, { timestamp: 't1', author: { username: 'sam' }, content: 'a' }]);
  if (m === 'POST' && url.endsWith('/messages')) { calls.push(body instanceof FormData ? 'FORM ' + body.get('files[0]').name + ' ' + await body.get('files[0]').text() : 'MSG ' + JSON.stringify(body)); return Response.json({ id: '1' }); }
  return new Response(null, { status: 204 });
};
const hub = { idFromName: () => 'x', get: () => ({ fetch: async () => new Response(hub.hits++ >= hub.max ? 'l' : 'ok', { status: hub.hits > hub.max ? 429 : 200 }) }) };
hub.hits = 0; hub.max = 99;
const send = async (obj, { bad = false } = {}) => {
  const body = JSON.stringify(obj), ts = '1'; let sig = toHex(await crypto.subtle.sign('Ed25519', kp.privateKey, new TextEncoder().encode(ts + body)));
  if (bad) sig = sig.replace(/^../, (h) => (h === 'ff' ? '00' : 'ff'));
  const r = await handleInteraction(new Request('https://x/discord/interactions', { method: 'POST', body, headers: { 'x-signature-ed25519': sig, 'x-signature-timestamp': ts } }), { DISCORD_PUBLIC_KEY: pub, DISCORD_BOT_TOKEN: 't', TICKET_DELAY_MS: 0, HUB: hub }, f);
  return { s: r.status, j: await r.json().catch(() => null) };
};
const click = (id, uid = '777', roles = [], extra = {}) => ({ type: 3, guild_id: GUILD, application_id: '555', channel_id: extra.channel_id, data: { custom_id: id }, member: { user: { id: uid, username: 'Sam_K!' }, roles } });
reset();
let r = await send(click('tzticket:open'), { bad: true }); ok(r.s === 401 && !calls.length, 'bad signature -> 401, no calls');
r = await send({ ...click('tzticket:open'), guild_id: '42' }); ok(r.j.data.flags === 64 && !calls.length, 'wrong guild refused, no calls');
r = await send(click('tzticket:open'));
const cat = chans.find((c) => c.type === 4), t = chans.find((c) => c.type === 0 && c.topic);
ok(cat && cat.name === '🎫 TICKETS' && cat.permission_overwrites[0].deny === '1024', 'category created, @everyone denied');
ok(t && /^ticket-samk-\d{4}$/.test(t.name) && t.parent_id === cat.id && t.topic === 'tzticket:777', 'channel name, parent, topic = opener id');
const ow = (id) => t.permission_overwrites.find((o) => o.id === id);
ok(ow(GUILD).deny === '1024' && ow('777').allow === '101376' && ow(MOD).allow === '109568' && ow(ADMIN).allow === '109568' && ow('555').allow === '109568', 'overwrites: everyone deny view; member/mod/admin/bot allow');
ok(r.j.data.flags === 64 && r.j.data.content.includes('<#' + t.id + '>'), 'ephemeral reply links the ticket');
const first = calls.find((c) => c.startsWith('MSG '));
ok(first.includes('<@777>') && first.includes('"roles":["' + MOD + '"]') && first.includes('tzticket:close') && first.includes('support@tradezoro.com'), 'first message: mention, mod ping limited, close button');
const before = chans.length; r = await send(click('tzticket:open'));
ok(chans.length === before && r.j.data.content.includes('<#' + t.id + '>') && /already/.test(r.j.data.content), 'second open returns existing');
hub.hits = 3; hub.max = 3; r = await send(click('tzticket:open', '888')); ok(/limit/.test(r.j.data.content) && chans.length === before, 'rate limit 3/day refused');
const cl = (uid, roles) => send(click('tzticket:close', uid, roles, { channel_id: t.id }));
calls = []; r = await cl('999', []); ok(/Only the ticket opener/.test(r.j.data.content) && !calls.some((c) => c.startsWith('DELETE')), 'other member refused, nothing deleted');
calls = []; r = await cl('777', []);
ok(r.j.type === 6 && calls.some((c) => c === 'DELETE /channels/' + t.id), 'opener closes: silent ack, channel deleted');
ok(calls.some((c) => c.startsWith('FORM ticket-samk') && c.includes('sam: a') && c.indexOf('sam: a') < c.indexOf('mod: b')) && calls.some((c) => c.includes('Closed by Sam_K!')), 'transcript (chronological) to mod-log + closed-by note');
calls = []; r = await cl('1', [MOD]); ok(r.j.type === 6 && calls.some((c) => c.startsWith('DELETE')), 'staff (Moderator) closes');
calls = []; r = await cl('1', [ADMIN]); ok(r.j.type === 6, 'staff (Admin) closes');
chans = chans.filter((c) => c.id !== '5'); calls = []; r = await cl('777', []); ok(!calls.some((c) => c.startsWith('DELETE')), 'no mod-log -> ticket kept');
chans.push({ id: '6', type: 0, name: 'general', topic: 'hello' }); calls = []; r = await send(click('tzticket:close', '1', [ADMIN], { channel_id: '6' })); ok(/not a ticket/.test(r.j.data.content) && !calls.some((c) => c.startsWith('DELETE')), 'non-ticket channel cannot be closed');
console.log(fails ? fails + ' FAILED' : 'ALL PASSED'); process.exit(fails ? 1 : 0);
