// node workers/discord-roles/test/autoban.test.mjs  (mock Discord via a fake dc)
import { DatabaseSync } from 'node:sqlite';
import { runAutoban, RULE } from '../src/autoban.js';
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const db = new DatabaseSync(':memory:');
const sql = { exec(q, ...a) { const st = db.prepare(q); return /^\s*select/i.test(q) ? st.all(...a) : (st.run(...a), []); } };
const G = '1565740274116857887';
const hit = (id, uid, bot = false, rule = RULE, type = 24) => ({ id, type, author: { id: uid, bot }, embeds: [{ fields: [{ name: 'rule_name', value: rule }] }] });
const W = { msgs: [], calls: [], members: {}, banStatus: 200 };
const dc = async (method, path, body, o = {}) => {
  W.calls.push({ method, path, body, reason: o.reason });
  const R = (data, status = 200) => ({ ok: status < 300, status, data });
  if (path === '/guilds/' + G + '/channels') return R([{ id: 'c1', type: 0, name: '💬・chat' }, { id: 'ml', type: 0, name: '📋・mod-log' }]);
  if (path === '/guilds/' + G) return R({ owner_id: 'OWNER' });
  if (path === '/guilds/' + G + '/roles') return R([{ id: 'r-mod', name: 'Moderator', permissions: '0' }, { id: 'r-adm', name: 'X', permissions: '8' }, { id: 'r-x', name: 'Fan', permissions: '0' }]);
  if (path.startsWith('/guilds/' + G + '/members/')) { const m = W.members[path.split('/').pop()]; return m ? R(m) : R({}, 404); }
  if (path.startsWith('/channels/ml/messages?')) { const a = (path.match(/after=(\d+)/) || [])[1]; return R(a ? W.msgs.filter((m) => BigInt(m.id) > BigInt(a)).reverse() : W.msgs.slice(-1)); }
  if (method === 'PUT' && path.includes('/bans/')) return R(null, W.banStatus === 200 ? 204 : W.banStatus);
  if (method === 'POST') return R({});
  return R({}, 404);
};
const bans = () => W.calls.filter((c) => c.method === 'PUT' && c.path.includes('/bans/'));
const run = async () => { W.calls = []; return runAutoban(sql, dc, G, () => {}); };

W.msgs = [hit('100', 'OLD')];
let r = await run(); ok(r.initialised && !bans().length, 'first run: only records latest id, no ban on history');
W.msgs.push(hit('101', 'SCAM'), hit('102', 'OWNER'), hit('103', 'MODGUY'), hit('104', 'ADMGUY'), hit('105', 'BOT', true), hit('106', 'OTHER', false, 'some other rule'), hit('107', 'CHAT', false, RULE, 0));
W.members = { SCAM: { user: {}, roles: ['r-x'] }, MODGUY: { user: {}, roles: ['r-mod'] }, ADMGUY: { user: {}, roles: ['r-adm'] }, BOT: { user: { bot: true }, roles: [] } };
r = await run(); const b = bans();
ok(b.length === 1 && b[0].path === '/guilds/' + G + '/bans/SCAM', 'bans only the offender');
ok(b[0].body.delete_message_seconds === 604800 && b[0].reason === 'Auto-ban: scam rule', 'delete 7 days + audit reason');
ok(W.calls.some((c) => c.method === 'POST' && c.path === '/channels/ml/messages' && /Auto-banned <@SCAM> \(scam rule\)/.test(c.body.content)), 'posts the mod-log line');
ok(!b.some((x) => /OWNER|MODGUY|ADMGUY|BOT|OTHER|CHAT|OLD/.test(x.path)), 'skips owner/mod/admin/bot, other rules, non-24, old');
W.msgs.push(hit('108', 'SCAM'));
r = await run(); ok(!bans().length, 'idempotent: already-banned user never banned twice');
r = await run(); ok(!W.calls.some((c) => c.path.includes('after=100')) && W.calls.some((c) => c.path.endsWith('after=108')), 'respects last-seen id');
W.msgs.push(hit('109', 'NEW2')); W.banStatus = 500;
r = await run(); ok(r.error && !bans().every((x) => x.path.endsWith('NEW2')) === false, 'server error: retried, id not advanced');
W.banStatus = 200; r = await run(); ok(bans().length === 1 && bans()[0].path.endsWith('NEW2'), 'retry succeeds next run');
console.log(fails ? fails + ' FAILED' : 'ALL PASSED'); process.exit(fails ? 1 : 0);
