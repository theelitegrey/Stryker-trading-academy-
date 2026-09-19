// Economic calendar — headless render test.
//
//   (setsid nohup python3 -m http.server 8000 --directory "$PWD" >/dev/null 2>&1 &)
//   node scratchpad/ec-test.js
//
// Drives economic-calendar.html in headless Chromium and asserts what the page
// promises: the currency row is the file's declared coverage, filtering a chip
// actually filters, and a currency with nothing scheduled still gets a chip.
//
// WHY NOTHING HERE NAMES A CURRENCY
//
// It used to. The test waited for `.ec-chip[data-cur="ZAR"]` and passed for
// months, until a refresh narrowed the window to a fortnight in which South
// Africa printed nothing. The renderer dropped the chip, the test timed out,
// and the failure pointed at the calendar rather than at the two real defects
// — a renderer hiding declared coverage, and a test asserting against one
// week's data. Both are fixed; this file keeps its half fixed by reading the
// currency to exercise out of assets/econ-calendar.json at run time. It has to
// pass on any valid data window, including one where every event is USD.

const fs = require('fs');
const path = require('path');
const http = require('http');

const ROOT = path.resolve(__dirname, '..');
const ORIGIN = process.env.EC_ORIGIN || 'http://localhost:8000';
const PAGE = ORIGIN + '/economic-calendar.html';
const DATA = path.join(ROOT, 'assets', 'econ-calendar.json');

// playwright-core ships inside the globally installed playwright in this
// image and there is no node_modules here, so resolve it by hand rather than
// making the whole repo carry a package.json for one test.
function loadPlaywright() {
  const tries = [
    'playwright-core',
    'playwright',
    '/opt/node22/lib/node_modules/playwright/node_modules/playwright-core',
    '/opt/node22/lib/node_modules/playwright-core'
  ];
  for (const id of tries) {
    try { return require(id); } catch (e) { /* next */ }
  }
  throw new Error('playwright-core not found. Tried:\n  ' + tries.join('\n  '));
}

const BROWSER = process.env.EC_CHROMIUM ||
  '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';

// ---- tiny harness ----------------------------------------------------------

let passed = 0;
const failures = [];

function check(name, fn) {
  try {
    fn();
    passed++;
    console.log('  ok   ' + name);
  } catch (err) {
    failures.push(name + ': ' + err.message);
    console.log('  FAIL ' + name + '\n         ' + err.message);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function eq(actual, expected, msg) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  assert(a === b, (msg || 'mismatch') + '\n         expected ' + b + '\n         actual   ' + a);
}

// ---- what the file says ----------------------------------------------------

const data = JSON.parse(fs.readFileSync(DATA, 'utf8'));
const declared = (data.currencies || []).map((c) => c.code);
const events = data.events || [];

const countByCur = {};
declared.forEach((c) => { countByCur[c] = 0; });
events.forEach((e) => { countByCur[e.cur] = (countByCur[e.cur] || 0) + 1; });

// The currency to exercise the filter with: whichever declared currency has
// the most events in this file. There is always one as long as the file has
// any events at all, whatever window it covers.
const busiest = declared.slice().sort((a, b) => countByCur[b] - countByCur[a])[0];

// A declared currency with nothing scheduled, if this window happens to have
// one. Its chip is the regression this test exists for. A file where every
// declared currency has events is perfectly valid, so this stays optional.
const quiet = declared.find((c) => countByCur[c] === 0) || null;

function waitForServer(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const poke = () => {
      const req = http.get(ORIGIN + '/assets/econ-calendar.json', (res) => {
        res.resume();
        if (res.statusCode === 200) return resolve();
        retry(new Error('HTTP ' + res.statusCode));
      });
      req.on('error', retry);
    };
    const retry = (err) => {
      if (Date.now() > deadline) {
        return reject(new Error('no server on ' + ORIGIN + ' (' + err.message + ').\n' +
          'Start one:  (setsid nohup python3 -m http.server 8000 --directory "' + ROOT +
          '" >/dev/null 2>&1 &)'));
      }
      setTimeout(poke, 200);
    };
    poke();
  });
}

// ---- the run ---------------------------------------------------------------

async function main() {
  const { chromium } = loadPlaywright();
  await waitForServer(10000);

  const browser = await chromium.launch({ executablePath: BROWSER });
  const context = await browser.newContext();
  // A missing chip should read as a failed assertion within seconds, not as a
  // half-minute stall on a click that was never going to land.
  context.setDefaultTimeout(10000);

  // Nothing leaves the machine. Firebase, gstatic, fonts and analytics all
  // fail closed rather than hanging the load for their timeout.
  await context.route(/^https?:\/\/(?!localhost)/, (r) => r.abort());

  // ...which means the page's `firebase` global never arrives. Several of the
  // scripts economic-calendar.html loads touch it at parse time; a stub keeps
  // an unrelated ReferenceError out of the console this test reads.
  await context.addInitScript(() => {
    const noop = function () {};
    const never = function () { return new Promise(function () {}); };
    const auth = function () {
      return {
        onAuthStateChanged: function (cb) { if (typeof cb === 'function') cb(null); return noop; },
        setPersistence: function () { return Promise.resolve(); },
        signOut: function () { return Promise.resolve(); },
        currentUser: null
      };
    };
    auth.Auth = { Persistence: { LOCAL: 'local', SESSION: 'session', NONE: 'none' } };
    auth.GoogleAuthProvider = function () {};
    const chain = {};
    ['collection', 'doc', 'where', 'orderBy', 'limit'].forEach((k) => { chain[k] = () => chain; });
    chain.get = () => Promise.resolve({ exists: false, empty: true, docs: [], forEach: noop });
    chain.set = chain.update = chain.add = chain.delete = () => Promise.resolve();
    chain.onSnapshot = () => noop;
    window.firebase = {
      apps: [],
      initializeApp: function () { return {}; },
      auth: auth,
      firestore: Object.assign(function () { return chain; }, {
        FieldValue: { serverTimestamp: noop, increment: noop, arrayUnion: noop },
        Timestamp: { now: () => ({ toDate: () => new Date() }) }
      }),
      messaging: function () {
        return { getToken: never, onMessage: noop, requestPermission: never };
      }
    };
  });

  const page = await context.newPage();
  const consoleErrors = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));

  await page.goto(PAGE, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#ec-page .ec-controls', { timeout: 15000 });

  const chipState = () => page.$$eval('.ec-chip[data-cur]', (els) => els.map((el) => ({
    code: el.getAttribute('data-cur'),
    count: Number((el.querySelector('.ec-chip-n') || {}).textContent),
    on: el.classList.contains('is-on'),
    empty: el.classList.contains('is-empty'),
    disabled: el.disabled === true
  })));

  console.log('\neconomic calendar — ' + events.length + ' events, ' +
    declared.length + ' declared currencies, window ' +
    data.rangeStart + ' to ' + data.rangeEnd);
  console.log('  busiest currency: ' + busiest + ' (' + countByCur[busiest] + ' events)' +
    (quiet ? ', quiet currency: ' + quiet + ' (0 events)' : ', no quiet currency in this window'));
  console.log('');

  // --- the currency row is the declared coverage --------------------------

  const chips = await chipState();

  check('every declared currency has a chip, in file order', () => {
    eq(chips.map((c) => c.code), ['ALL'].concat(declared),
      'the chip row should be All plus currencies[] verbatim');
  });

  check('a currency with no events keeps its chip', () => {
    if (!quiet) return;   // nothing to assert on this window
    const chip = chips.find((c) => c.code === quiet);
    assert(chip, quiet + ' is declared in currencies[] but has no chip');
    assert(chip.count === 0, quiet + ' has no events but its chip reads ' + chip.count);
    assert(chip.empty, quiet + "'s chip reads 0 but is not dimmed (.is-empty)");
    assert(!chip.disabled, quiet + "'s chip is disabled — a 0 chip stays clickable");
  });

  // --- the filter filters ---------------------------------------------------

  await page.click('.ec-chip[data-range="all"]');
  await page.waitForFunction(() => document.querySelector('.ec-chip[data-range="all"].is-on') !== null);

  const allDateChips = await chipState();
  check('over all dates, each chip count matches the file', () => {
    // The badge answers "how many rows if I clicked this, leaving my other
    // choices alone", and with the impact floor at its default every event
    // counts — so over all dates it should be the file's own tally.
    allDateChips.filter((c) => c.code !== 'ALL').forEach((c) => {
      assert(c.count === (countByCur[c.code] || 0),
        c.code + ' chip reads ' + c.count + ', the file has ' + (countByCur[c.code] || 0));
    });
    const total = allDateChips.find((c) => c.code === 'ALL');
    assert(total.count === events.length,
      'All chip reads ' + total.count + ', the file has ' + events.length + ' events');
  });

  await page.click('.ec-chip[data-cur="' + busiest + '"]');
  await page.waitForFunction((c) =>
    document.querySelector('.ec-chip[data-cur="' + c + '"].is-on') !== null, busiest);

  const rowCurs = await page.$$eval('.ec-row .ec-cur .ec-code', (els) =>
    els.map((el) => el.textContent.trim()));

  check('selecting ' + busiest + ' shows only ' + busiest + ' rows', () => {
    assert(rowCurs.length > 0, 'no rows rendered after selecting ' + busiest);
    const other = rowCurs.filter((c) => c !== busiest);
    eq(other, [], busiest + ' selected but rows for other currencies are still on the page');
    assert(rowCurs.length === countByCur[busiest],
      busiest + ' has ' + countByCur[busiest] + ' events but ' + rowCurs.length + ' rows rendered');
  });

  check('the chip row does not reshuffle when a filter changes', () => {
    eq(allDateChips.map((c) => c.code), chips.map((c) => c.code),
      'the set of currency chips changed with the range — the control set must hold still');
  });

  // --- a quiet currency is an empty state, not a missing control ------------

  if (quiet && await page.$('.ec-chip[data-cur="' + quiet + '"]')) {
    await page.click('.ec-chip[data-cur="' + quiet + '"]');
    await page.waitForFunction((c) =>
      document.querySelector('.ec-chip[data-cur="' + c + '"].is-on') !== null, quiet);

    const empty = await page.$$eval('#ec-days .ec-empty', (els) => els.map((el) => el.textContent));
    const stillThere = await page.$('.ec-chip[data-cur="' + busiest + '"]');

    check('selecting ' + quiet + ' lands on the empty state', () => {
      assert(empty.length === 1, 'expected one empty state, found ' + empty.length);
      assert(/filters/i.test(empty[0]),
        'the empty state should blame the filters, not the file: ' + JSON.stringify(empty[0]));
    });
    check('the other chips survive an empty selection', () => {
      assert(stillThere, busiest + "'s chip disappeared while " + quiet + ' was selected');
    });
  } else if (quiet) {
    // The chip is missing, which the first check already reported. Say why the
    // rest of this section did not run rather than waiting out a click timeout
    // on an element that is never going to appear.
    check('selecting ' + quiet + ' lands on the empty state', () => {
      assert(false, quiet + ' has no chip to click — see the chip-row check above');
    });
  }

  // --- the file's own rules -------------------------------------------------

  check('no wall-clock time carries a zone name', () => {
    // Times are UTC in the file and converted on screen. "08:30 ET" baked into
    // an event is wrong for most readers all year and wrong for everyone twice
    // a year, so it fails the build.
    const zoned = /\d{1,2}:\d{2}\s*(ET|EST|EDT|CT|CST|CDT|PT|PST|PDT|GMT|BST|CET|CEST|JST|SAST)\b/i;
    const hits = [];
    events.forEach((e) => {
      Object.keys(e).forEach((k) => {
        if (typeof e[k] === 'string' && zoned.test(e[k])) hits.push(e.event + ' → ' + k + ': ' + e[k]);
      });
    });
    eq(hits, [], 'events carry a time with a zone name; every time belongs in `at`, in UTC');
  });

  check('every event timestamp is UTC', () => {
    const bad = events.filter((e) => !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(e.at || ''))
      .map((e) => e.event + ' → ' + e.at);
    eq(bad, [], 'every `at` must be an ISO timestamp ending in Z');
  });

  check('every currency used is declared', () => {
    const used = new Set(events.map((e) => e.cur));
    (data.banks || []).forEach((b) => used.add(b.cur));
    if (data.defaultCurrency) used.add(data.defaultCurrency);
    const undeclared = [...used].filter((c) => declared.indexOf(c) === -1);
    eq(undeclared, [], 'used but missing from currencies[]');
  });

  check('every policy card leads with a rate', () => {
    const rateless = (data.banks || []).filter((b) => !b.rate).map((b) => b.bank || b.cur);
    eq(rateless, [], 'a bank card with no rate has a dash for a hero — leave it out instead');
  });

  check('the page loaded without errors', () => {
    // Blocked third-party requests are the point of the route above.
    const real = consoleErrors.filter((t) =>
      !/ERR_FAILED|ERR_BLOCKED|net::|Failed to load resource|gstatic|firebase/i.test(t));
    eq(real, [], 'console errors during render');
  });

  await browser.close();

  console.log('\n' + passed + ' passed, ' + failures.length + ' failed');
  if (failures.length) process.exit(1);
}

main().catch((err) => {
  console.error('\n' + err.stack || err);
  process.exit(1);
});
