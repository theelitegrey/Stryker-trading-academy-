// Stryker Trading Academy — header Global Monitor icon
// Depends on: assets/auth.js (for the header to exist at all)
//
// Injected into .topnav-right rather than added to 30-odd pages of markup, the
// same approach as the messages icon and account menu.
//
// THE DOT MEANS SOMETHING, WHICH IS THE HARD PART
//
// A permanently-lit alert dot is worse than no dot: within a day people stop
// seeing it, and then it cannot warn them of anything. The monitor's wire
// almost always carries at least one high-severity headline — a dot bound to
// "is there anything high-severity" would be lit essentially forever.
//
// So it lights for headlines the person HAS NOT SEEN. Opening Global Monitor
// records the data file's generatedAt; the dot then reflects critical and high
// items published since. Read it, and it goes out until something new lands.
//
// COST
//
// monitor-data.json is ~212KB — far too heavy to pull on every page load for a
// dot. It is fetched at most once per 20 minutes per browser (matching the
// pipeline's own cadence), and only the derived counts are kept. The fetch is
// deferred to idle time so it never competes with the page itself, and any
// failure is silent: a missing dot is a non-event, and an error banner about a
// decorative icon would be worse than the thing it reports.

(function () {

  var DATA_URL = 'https://raw.githubusercontent.com/theelitegrey/Stryker-trading-academy-/data/monitor-data.json';
  var CACHE_KEY = 'stryker_gm_alert';       // { at, generatedAt, critical, high }
  var SEEN_KEY  = 'stryker_gm_seen';        // generatedAt of the last visit
  var TTL_MS    = 20 * 60 * 1000;           // the pipeline's refresh interval

  var ICON =
    '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-width="1.9" stroke-linecap="round">' +
      '<circle cx="12" cy="12" r="9"/>' +
      '<path d="M3.2 9.5h17.6M3.2 14.5h17.6"/>' +
      '<path d="M12 3a15 15 0 0 1 0 18a15 15 0 0 1 0-18z"/>' +
    '</svg>';

  function read(key) {
    try { return JSON.parse(localStorage.getItem(key) || 'null'); }
    catch (e) { return null; }
  }
  function write(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {}
  }

  function build() {
    var right = document.querySelector('.topnav-right');
    if (!right || document.getElementById('gm-icon-wrap')) return null;

    var wrap = document.createElement('div');
    wrap.className = 'gm-icon-wrap';
    wrap.id = 'gm-icon-wrap';
    wrap.innerHTML =
      '<a href="global-monitor.html" class="icon-btn" aria-label="Global Monitor" ' +
        'title="Global Monitor">' + ICON + '</a>' +
      '<span class="gm-alert-dot" id="gm-alert-dot" aria-hidden="true"></span>';

    // First in the row, so the header reads monitor, messages, notifications,
    // account — global to personal.
    right.insertBefore(wrap, right.firstChild);
    return wrap;
  }

  function applyDot(state) {
    var dot = document.getElementById('gm-alert-dot');
    var wrap = document.getElementById('gm-icon-wrap');
    if (!dot || !state) return;

    var seen = read(SEEN_KEY);
    // Unseen means the data file has been regenerated since the last visit AND
    // it carries something worth interrupting for.
    var isNew = !seen || !seen.generatedAt || state.generatedAt > seen.generatedAt;
    var worth = (state.critical > 0) || (state.high > 0);

    if (isNew && worth) {
      dot.style.display = 'block';
      dot.classList.toggle('is-critical', state.critical > 0);
      if (wrap) {
        wrap.querySelector('a').setAttribute('title',
          'Global Monitor — ' + state.critical + ' critical, ' + state.high + ' high');
      }
    } else {
      dot.style.display = 'none';
    }
  }

  function refresh() {
    var cached = read(CACHE_KEY);
    if (cached && (Date.now() - cached.at) < TTL_MS) { applyDot(cached); return; }

    fetch(DATA_URL, { cache: 'default' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (!d) return;
        var wire = (d.wire && d.wire.items) || [];
        var state = {
          at: Date.now(),
          generatedAt: d.generatedAt || Date.now(),
          critical: wire.filter(function (w) { return w.sev === 'critical'; }).length,
          high: wire.filter(function (w) { return w.sev === 'high'; }).length
        };
        write(CACHE_KEY, state);
        applyDot(state);
      })
      .catch(function () {
        // Silent. A decorative icon must never produce a visible error, and a
        // stale-or-absent dot costs nothing.
      });
  }

  function markSeen() {
    // Called on the monitor page itself. Uses the cached generatedAt rather
    // than the clock, so "seen" refers to a specific batch of data — a
    // timestamp would mark future batches seen if the clocks disagreed.
    var cached = read(CACHE_KEY);
    write(SEEN_KEY, { generatedAt: cached ? cached.generatedAt : Date.now(),
                      at: Date.now() });
    var dot = document.getElementById('gm-alert-dot');
    if (dot) dot.style.display = 'none';
  }

  document.addEventListener('DOMContentLoaded', function () {
    if (!build()) return;

    var onMonitor = /global-monitor\.html/.test(location.pathname);
    if (onMonitor) {
      // Refresh first so "seen" records the batch actually being read, not
      // whatever was cached from an earlier page.
      refresh();
      setTimeout(markSeen, 1500);
      return;
    }

    // Deferred to idle: a 212KB fetch for a dot must not compete with the page
    // the person actually asked for.
    if ('requestIdleCallback' in window) {
      requestIdleCallback(refresh, { timeout: 4000 });
    } else {
      setTimeout(refresh, 1200);
    }
  });

})();
