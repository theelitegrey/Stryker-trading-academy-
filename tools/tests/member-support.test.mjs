import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const rules = fs.readFileSync(new URL('../../functions-src/firestore.rules', import.meta.url), 'utf8');
const fn = fs.readFileSync(new URL('../../functions-src/supportTickets.js', import.meta.url), 'utf8');
const contactFn = fs.readFileSync(new URL('../../functions-src/onContactMessageCreated.js', import.meta.url), 'utf8');
const memberUi = fs.readFileSync(new URL('../../assets/support-tickets.js', import.meta.url), 'utf8');
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
});

test('notifications use existing collection, trusted recipients and exact deep links', () => {
  assert.match(fn, /collection\('notifications'\)/);
  assert.match(fn, /recipientUid: doc\.id/);
  assert.match(fn, /recipientUid: ticket\.ownerUid/);
  assert.match(fn, /link: 'support-admin#ticket-' \+ ticketId/);
  assert.match(fn, /link: 'help#ticket-' \+ ticketId/);
  assert.match(fn, /notificationId\(ticketId, eventId/);
  assert.match(contactFn, /link: 'support-admin\.html#contact-' \+ event\.params\.messageId/);
  assert.doesNotMatch(contactFn, /pages-admin\.html#contact-/);
});

test('member and admin UIs open exact ticket hashes and expose required actions', () => {
  assert.match(memberUi, /\^#ticket-\(\[A-Za-z0-9_-\]\+\)\$/);
  assert.match(memberUi, /action:'create'/);
  assert.match(memberUi, /action:'reply'/);
  assert.match(memberUi, /action:'status'/);
  assert.match(memberUi, /waiting_for_support: 'Waiting for support'/);
  assert.match(memberUi, /waiting_for_member: 'Waiting for you'/);
  assert.match(adminUi, /linkedTicket\(\)/);
  assert.match(adminUi, /data-ticket-filter/);
  assert.match(adminUi, /action:'reply'/);
  assert.match(adminUi, /action:'status'/);
});
