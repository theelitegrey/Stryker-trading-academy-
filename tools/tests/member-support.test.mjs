import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const rules = fs.readFileSync(new URL('../../functions-src/firestore.rules', import.meta.url), 'utf8');
const fn = fs.readFileSync(new URL('../../functions-src/supportTickets.js', import.meta.url), 'utf8');
const contactFn = fs.readFileSync(new URL('../../functions-src/onContactMessageCreated.js', import.meta.url), 'utf8');
const adminUi = fs.readFileSync(new URL('../../assets/support-admin.js', import.meta.url), 'utf8');

function block(source, start, end) {
  const at = source.indexOf(start);
  assert.notEqual(at, -1, `missing ${start}`);
  const until = source.indexOf(end, at);
  assert.notEqual(until, -1, `missing end ${end}`);
  return source.slice(at, until);
}

const contactRules = block(rules, 'match /contactMessages/{id}', 'match /contactNotifyThrottle');
const ticketRules = block(rules, 'match /supportTickets/{ticketId}', '// ---------------------------------------------------------------------', rules.indexOf('match /supportTickets/{ticketId}'));

test('public contact creates are anonymous, bounded and shape checked', () => {
  assert.match(contactRules, /allow create: if !signedIn\(\)/);
  assert.match(contactRules, /hasOnly\(\['name', 'email', 'message', 'status', 'createdAt'\]\)/);
  assert.match(contactRules, /name\.size\(\) <= 100/);
  assert.match(contactRules, /email\.size\(\) <= 254/);
  assert.match(contactRules, /message\.size\(\) <= 4000/);
  assert.match(contactRules, /status == 'new'/);
  assert.match(contactRules, /createdAt == request\.time/);
  assert.match(contactRules, /allow read, update, delete: if isAdmin\(\)/);
});

test('ticket reads are owner/admin only and every client mutation is denied', () => {
  assert.match(ticketRules, /isAdmin\(\) \|\| \(signedIn\(\) && resource\.data\.ownerUid == request\.auth\.uid\)/);
  assert.match(ticketRules, /allow create, update, delete: if false/);
  assert.match(ticketRules, /get\([^\n]+supportTickets\/\$\(ticketId\)\)\.data\.ownerUid == request\.auth\.uid/);
  assert.equal((ticketRules.match(/allow create, update, delete: if false/g) || []).length, 2);
});

test('callable pins ownership and sender roles instead of trusting request data', () => {
  assert.match(fn, /ownerUid: user\.uid/);
  assert.match(fn, /role = actor\.isAdmin \? 'admin' : 'member'/);
  assert.match(fn, /ticket\.ownerUid !== actor\.uid/);
  assert.match(fn, /Members can only close or reopen their own ticket/);
  assert.match(fn, /CATEGORIES = \['Account', 'Billing', 'Charts & data', 'Creator Hub', 'Technical issue', 'Other'\]/);
  assert.match(fn, /clean\(data\.message, 4000/);
  assert.match(fn, /requestId\(data\.requestId\)/);
  assert.match(fn, /stableId\('ticket', user\.uid, opId\)/);
  assert.match(fn, /existingMessage\.exists/);
  assert.match(fn, /notifyAdminsInWrite\(tx/);
  assert.match(fn, /notifyOwnerInWrite\(tx/);
  assert.doesNotMatch(fn, /await notifyAdmins\(/);
});

test('notifications use existing collection, trusted recipients and exact deep links', () => {
  assert.match(fn, /collection\('notifications'\)/);
  assert.match(fn, /notificationData\(doc\.id, 'support_ticket_admin'/);
  assert.match(fn, /notificationData\(ticket\.ownerUid, 'support_ticket_member'/);
  assert.match(fn, /'support-admin#ticket-' \+ ticketId/);
  assert.match(fn, /'help#ticket-' \+ ticketId/);
  assert.match(fn, /notificationId\(ticketId, eventId/);
  assert.match(contactFn, /link: 'support-admin\.html#contact-' \+ event\.params\.messageId/);
  assert.doesNotMatch(contactFn, /pages-admin\.html#contact-/);
});

test('admin UI exposes the ticket actions (member UI removed, help moved to Discord)', () => {
  assert.match(adminUi, /linkedTicket\(\)/);
  assert.match(adminUi, /data-ticket-filter/);
  assert.match(adminUi, /action:'reply'/);
  assert.match(adminUi, /action:'status'/);
});

test('admin ticket inbox orders by updatedAt and fetches older deep-linked docs', () => {
  const admin = adminUi;
  assert.match(admin, /collection\('supportTickets'\)\.orderBy\('updatedAt','desc'\)\.limit\(200\)/);
  assert.match(admin, /TICKET_LINK_FETCHED\[want\]/);
  assert.match(admin, /CONTACT_LINK_FETCHED\[wantC\]/);
});

test('server-only support throttle collection is closed to clients', () => {
  assert.match(rules, /match \/supportTicketThrottle\/\{uid\} \{ allow read, write: if false; \}/);
  assert.match(fn, /CREATE_COOLDOWN_MS/);
});
