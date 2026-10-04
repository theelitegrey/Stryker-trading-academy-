// Unit tests for assets/market-hours.js (no browser). Run: node tools/tests/market-hours-test.js
// Exit code = number of failures.
const assert = require('assert');
const path = require('path');
const MH = require(path.join(__dirname, '../../assets/market-hours.js'));

let fails = 0;
function t(name, fn) {
  try { fn(); console.log('ok   ' + name); }
  catch (e) { fails++; console.log('FAIL ' + name + '\n     ' + e.message); }
}
const U = (s) => Date.parse(s); // ISO with explicit Z/offset
const H = 3600e3, M = 60e3;

// 2026 calendar facts: DST starts Sun Mar 8, ends Sun Nov 1. Thanksgiving Nov 26. Jul 4 = Sat -> observed Fri Jul 3.
t('Friday after close -> opens Monday 09:30 EDT', () => {
  const now = U('2026-10-02T20:30:00Z'); // Fri 16:30 EDT
  const s = MH.status(now);
  assert.strictEqual(s.open, false);
  assert.strictEqual(s.until, U('2026-10-05T13:30:00Z'));
  assert.strictEqual(MH.label(now).text, 'Opens in 2d 17h');
});
t('Saturday -> Monday open', () => {
  const s = MH.status(U('2026-10-03T16:00:00Z'));
  assert.strictEqual(s.open, false); assert.strictEqual(s.until, U('2026-10-05T13:30:00Z'));
});
t('Sunday evening -> Monday open, hours left', () => {
  const now = U('2026-10-04T23:30:00Z'); // Sun 19:30 EDT
  assert.strictEqual(MH.label(now).text, 'Opens in 14h 00m');
});
t('Monday pre-open 09:12 ET -> Opens in 18m 00s', () => {
  const now = U('2026-10-05T13:12:00Z');
  assert.strictEqual(MH.label(now).text, 'Opens in 18m 00s');
});
t('Monday mid-session -> Open, closes in 2h 05m', () => {
  const now = U('2026-10-05T17:55:00Z'); // 13:55 EDT
  const l = MH.label(now);
  assert.strictEqual(l.open, true); assert.strictEqual(l.text, 'Open, closes in 2h 05m');
});
t('exact 09:30 is open, exact 16:00 is closed', () => {
  assert.strictEqual(MH.status(U('2026-10-05T13:30:00Z')).open, true);
  assert.strictEqual(MH.status(U('2026-10-05T20:00:00Z')).open, false);
});
t('Thanksgiving closed -> Friday open, early close 13:00', () => {
  const s = MH.status(U('2026-11-26T15:00:00Z')); // Thu 10:00 EST
  assert.strictEqual(s.open, false); assert.strictEqual(s.until, U('2026-11-27T14:30:00Z'));
  const f = MH.status(U('2026-11-27T17:00:00Z')); // Fri 12:00 EST
  assert.strictEqual(f.open, true); assert.strictEqual(f.early, true); assert.strictEqual(f.until, U('2026-11-27T18:00:00Z'));
});
t('July 4 2026 (Sat) observed Fri Jul 3 -> closed, opens Mon Jul 6', () => {
  const s = MH.status(U('2026-07-03T15:00:00Z'));
  assert.strictEqual(s.open, false); assert.strictEqual(s.until, U('2026-07-06T13:30:00Z'));
});
t('July 4 2025 (Fri) closed; Thu Jul 3 2025 early close', () => {
  assert.strictEqual(MH.sessionFor(2025, 7, 4), null);
  assert.strictEqual(MH.sessionFor(2025, 7, 3).early, true);
});
t('Good Friday 2026 (Apr 3) and Juneteenth closed; Christmas Eve 2026 early', () => {
  assert.strictEqual(MH.sessionFor(2026, 4, 3), null);
  assert.strictEqual(MH.sessionFor(2026, 6, 19), null);
  assert.strictEqual(MH.sessionFor(2026, 12, 25), null);
  assert.strictEqual(MH.sessionFor(2026, 12, 24).early, true);
  assert.strictEqual(MH.sessionFor(2027, 1, 1), null);
  assert.strictEqual(MH.sessionFor(2027, 12, 31) !== null, true); // NY Day 2028 is Sat: no Friday closure
});
t('DST start week: Fri Mar 6 2026 opens 14:30Z, Mon Mar 9 opens 13:30Z', () => {
  assert.strictEqual(MH.sessionFor(2026, 3, 6).open, U('2026-03-06T14:30:00Z'));
  assert.strictEqual(MH.sessionFor(2026, 3, 9).open, U('2026-03-09T13:30:00Z'));
  // Fri after close -> Mon open spans the switch: 3 days minus 1 hour of wall time
  const now = U('2026-03-06T21:00:00Z'); // Fri 16:00 EST
  assert.strictEqual(MH.status(now).until - now, 2 * 24 * H + 16 * H + 30 * M);
});
t('DST end week: Fri Oct 30 2026 opens 13:30Z, Mon Nov 2 opens 14:30Z', () => {
  assert.strictEqual(MH.sessionFor(2026, 10, 30).open, U('2026-10-30T13:30:00Z'));
  assert.strictEqual(MH.sessionFor(2026, 11, 2).open, U('2026-11-02T14:30:00Z'));
  assert.strictEqual(MH.sessionFor(2026, 11, 2).close, U('2026-11-02T21:00:00Z'));
});
t('IST user: result independent of local zone; 19:00 IST Mon = 09:30 EDT open', () => {
  // 2026-10-05 19:00 IST (+05:30) = 13:30Z = 09:30 EDT
  const now = Date.parse('2026-10-05T19:00:00+05:30');
  assert.strictEqual(MH.status(now).open, true);
  const before = Date.parse('2026-10-05T18:59:00+05:30');
  assert.strictEqual(MH.label(before).text, 'Opens in 1m 00s');
  const fmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  assert.strictEqual(fmt.format(now), '19:00');
});
t('fmtLeft formats', () => {
  assert.strictEqual(MH.fmtLeft(3 * H + 12 * M + 5e3), '3h 12m');
  assert.strictEqual(MH.fmtLeft(59e3), '0m 59s');
  assert.strictEqual(MH.fmtLeft(-5), '0m 00s');
});

console.log(fails ? fails + ' failed' : 'all passed');
process.exit(fails);
