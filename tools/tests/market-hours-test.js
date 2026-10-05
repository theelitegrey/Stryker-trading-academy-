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

// ---- trading session clock (sessionStatus / sessionLabel / sessionHours) ----
// Asia 09:00-18:00 Tokyo, London 08:00-17:00 London, New York 08:00-17:00 New York.
// 2026: US DST Mar 8 -> Nov 1, UK BST Mar 29 -> Oct 25. Tokyo has no DST.
const L = (iso) => MH.sessionLabel(U(iso));
const IST = 'Asia/Kolkata';
t('sessions: Asia only (Owner example) -> London opens in 05:33:25', () => {
  const l = L('2026-10-06T01:26:35Z'); // Tue 10:26:35 Tokyo, 06:56:35 IST
  assert.strictEqual(l.text, 'Asia Session is Open \u00b7 Next Session: London opens in 05:33:25');
  assert.strictEqual(l.short, 'Asia open \u00b7 London in 05:33:25');
  assert.strictEqual(l.open, true);
});
t('sessions: London only -> New York opens in 02:00:00', () => {
  assert.strictEqual(L('2026-10-06T10:00:00Z').text, 'London Session is Open \u00b7 Next Session: New York opens in 02:00:00');
  assert.strictEqual(L('2026-10-06T10:00:00Z').short, 'London open \u00b7 NY in 02:00:00');
});
t('sessions: London & New York overlap -> next is Asia (not open now)', () => {
  const l = L('2026-10-06T13:49:55Z');
  assert.strictEqual(l.text, 'London & New York Sessions are Open \u00b7 Next Session: Asia opens in 10:10:05');
  assert.strictEqual(l.short, 'London & NY open \u00b7 Asia in 10:10:05');
});
t('sessions: New York only after London close', () => {
  assert.strictEqual(L('2026-10-06T18:00:00Z').text, 'New York Session is Open \u00b7 Next Session: Asia opens in 06:00:00');
});
t('sessions: boundaries are [open, close)', () => {
  assert.deepStrictEqual(L('2026-10-06T07:00:00Z').sessions, ['Asia', 'London']); // London opens 08:00 BST
  assert.deepStrictEqual(L('2026-10-06T09:00:00Z').sessions, ['London']);         // Asia closes 18:00 Tokyo
  assert.deepStrictEqual(L('2026-10-06T21:00:00Z').sessions, []);                 // NY closes 17:00 EDT
});
t('sessions: weekday gap -> No session open, Asia countdown', () => {
  const l = L('2026-10-06T22:47:20Z');
  assert.strictEqual(l.open, false); assert.strictEqual(l.weekend, false);
  assert.strictEqual(l.text, 'No session open \u00b7 Next Session: Asia opens in 01:12:40');
  assert.strictEqual(l.short, 'Closed \u00b7 Asia in 01:12:40');
});
t('sessions: weekend from Fri 17:00 New York until Monday Asia open', () => {
  assert.deepStrictEqual(L('2026-10-09T20:59:59Z').sessions, ['New York']);
  const fri = L('2026-10-09T21:00:00Z'); // Fri 17:00 EDT
  assert.strictEqual(fri.weekend, true);
  assert.strictEqual(fri.text, 'Markets closed (weekend) \u00b7 Next Session: Asia opens in 2d 03:00:00');
  assert.strictEqual(L('2026-10-10T12:00:00Z').text, 'Markets closed (weekend) \u00b7 Next Session: Asia opens in 1d 12:00:00');
  assert.strictEqual(L('2026-10-11T23:59:00Z').text, 'Markets closed (weekend) \u00b7 Next Session: Asia opens in 00:01:00');
  assert.strictEqual(L('2026-10-11T23:59:00Z').short, 'Weekend \u00b7 Asia in 00:01:00');
  assert.strictEqual(L('2026-10-12T00:00:00Z').text, 'Asia Session is Open \u00b7 Next Session: London opens in 07:00:00');
  // Saturday morning Tokyo (Fri evening UTC) is not an Asia session
  assert.deepStrictEqual(L('2026-10-10T01:00:00Z').sessions, []);
});
t('sessions: IST tooltip hours (Owner example)', () => {
  assert.strictEqual(MH.sessionHours(U('2026-10-06T03:00:00Z'), IST),
    'Asia 05:30\u201314:30 \u00b7 London 12:30\u201321:30 \u00b7 New York 17:30\u201302:30');
});
t('sessions: spring DST weeks (US Mar 8, UK Mar 29 2026), IST hours', () => {
  // before both: GMT + EST
  assert.strictEqual(MH.sessionHours(U('2026-03-03T03:00:00Z'), IST),
    'Asia 05:30\u201314:30 \u00b7 London 13:30\u201322:30 \u00b7 New York 18:30\u201303:30');
  // gap weeks: GMT + EDT -> NY opens 12:00Z while London still runs to 17:00Z
  assert.strictEqual(MH.sessionHours(U('2026-03-10T03:00:00Z'), IST),
    'Asia 05:30\u201314:30 \u00b7 London 13:30\u201322:30 \u00b7 New York 17:30\u201302:30');
  assert.deepStrictEqual(L('2026-03-10T12:00:00Z').sessions, ['London', 'New York']);
  assert.strictEqual(L('2026-03-10T09:00:00Z').next.at, U('2026-03-10T12:00:00Z'));
  // after both: BST + EDT
  assert.strictEqual(MH.sessionHours(U('2026-03-31T03:00:00Z'), IST),
    'Asia 05:30\u201314:30 \u00b7 London 12:30\u201321:30 \u00b7 New York 17:30\u201302:30');
  // UK switch weekend: London Fri Mar 27 opens 08:00Z, Mon Mar 30 opens 07:00Z
  assert.strictEqual(L('2026-03-27T06:00:00Z').next.at, U('2026-03-27T08:00:00Z'));
  assert.strictEqual(L('2026-03-30T06:00:00Z').next.at, U('2026-03-30T07:00:00Z'));
  // US switch weekend: weekend starts Fri 17:00 EST = 22:00Z
  assert.deepStrictEqual(L('2026-03-06T21:30:00Z').sessions, ['New York']);
  assert.strictEqual(L('2026-03-06T22:00:00Z').text, 'Markets closed (weekend) \u00b7 Next Session: Asia opens in 2d 02:00:00');
});
t('sessions: autumn DST weeks (UK Oct 25, US Nov 1 2026), IST hours', () => {
  // gap week: GMT + EDT
  assert.strictEqual(MH.sessionHours(U('2026-10-27T03:00:00Z'), IST),
    'Asia 05:30\u201314:30 \u00b7 London 13:30\u201322:30 \u00b7 New York 17:30\u201302:30');
  assert.strictEqual(L('2026-10-27T07:30:00Z').text, 'Asia Session is Open \u00b7 Next Session: London opens in 00:30:00');
  // after both: GMT + EST
  assert.strictEqual(MH.sessionHours(U('2026-11-03T03:00:00Z'), IST),
    'Asia 05:30\u201314:30 \u00b7 London 13:30\u201322:30 \u00b7 New York 18:30\u201303:30');
  assert.deepStrictEqual(L('2026-11-02T21:30:00Z').sessions, ['New York']); // 16:30 EST
  assert.strictEqual(L('2026-10-30T21:00:00Z').weekend, true); // Fri 17:00 EDT
  assert.strictEqual(L('2026-11-06T21:30:00Z').weekend, false); // Fri 16:30 EST: NY still open
});
t('fmtClock formats', () => {
  assert.strictEqual(MH.fmtClock(5 * H + 33 * M + 25e3), '05:33:25');
  assert.strictEqual(MH.fmtClock(29 * H + 33 * M + 25e3), '1d 05:33:25');
  assert.strictEqual(MH.fmtClock(-1), '00:00:00');
});

console.log(fails ? fails + ' failed' : 'all passed');
process.exit(fails);
