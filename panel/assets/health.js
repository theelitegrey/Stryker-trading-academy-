/* Master Panel — health data and the alert engine.
 *
 * WHERE HEALTH DATA COMES FROM
 * A browser cannot read another origin's status code, response headers or TLS
 * certificate — CORS forbids it, and that is exactly the data an audit needs.
 * So the real checks run in GitHub Actions (.github/workflows/panel-health.yml)
 * and publish one JSON file to the `panel-data` branch, which the panel reads
 * over raw.githubusercontent.com. Same relay the Global Monitor already uses.
 *
 * The client-side ping below is a fallback, not a substitute: a no-cors fetch
 * resolves opaquely for any HTTP response and rejects on DNS/TLS/connection
 * failure, so it can tell you "reachable" and roughly how fast, and nothing else.
 */
PANEL.health = (function () {
  'use strict';

  var data = null, fetchedAt = 0, inflight = null;

  function url() {
    var c = PANEL.cfg();
    return 'https://raw.githubusercontent.com/' + c.healthRepo + '/' + c.healthBranch +
      '/panel-health.json?t=' + Date.now();
  }

  function fetchHealth(force) {
    if (data && !force && Date.now() - fetchedAt < 60000) return Promise.resolve(data);
    if (inflight) return inflight;
    inflight = fetch(url(), { cache: 'no-store' })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (j) { data = j; fetchedAt = Date.now(); inflight = null; return j; })
      .catch(function (err) {
        inflight = null;
        console.warn('panel: health feed unavailable', err);
        return null;       // views render the "not set up yet" state
      });
    return inflight;
  }

  function bySiteUrl(feed, siteUrl) {
    if (!feed || !feed.sites) return null;
    var want = normalise(siteUrl);
    return feed.sites.filter(function (s) { return normalise(s.url) === want; })[0] || null;
  }
  function normalise(u) {
    return String(u || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/+$/, '');
  }

  /* Uptime over the retained history, as a percentage. */
  function uptime(feed, siteId, days) {
    var hist = feed && feed.history && feed.history[siteId];
    if (!hist || !hist.length) return null;
    var cutoff = Date.now() - days * PANEL.DAY;
    var rows = hist.filter(function (h) { return h.t >= cutoff; });
    if (!rows.length) return null;
    var up = rows.filter(function (h) { return h.ok; }).length;
    return { pct: up / rows.length * 100, samples: rows.length, rows: rows };
  }

  /* Opaque reachability probe. Resolves {reachable, ms} — never a status code. */
  function ping(siteUrl) {
    var started = performance.now();
    var ctrl = new AbortController();
    var timer = setTimeout(function () { ctrl.abort(); }, 12000);
    return fetch(siteUrl, { mode: 'no-cors', cache: 'no-store', signal: ctrl.signal })
      .then(function () {
        clearTimeout(timer);
        return { reachable: true, ms: Math.round(performance.now() - started) };
      })
      .catch(function () {
        clearTimeout(timer);
        return { reachable: false, ms: Math.round(performance.now() - started) };
      });
  }

  /* ------------------------------------------------------------------
     Alerts. One function builds every warning the panel shows, so the
     topbar chip, the overview and the ops view can never disagree.
     Severity: 'bad' needs action now, 'warn' needs action soon.
     ------------------------------------------------------------------ */
  function build(feed) {
    var c = PANEL.cfg();
    var out = [];
    var sites = PANEL.get('sites');
    var subs = PANEL.get('subscriptions');
    var expenses = PANEL.get('expenses');

    // --- sites down / degraded -------------------------------------
    if (feed && feed.sites) {
      feed.sites.forEach(function (s) {
        var site = sites.filter(function (x) { return normalise(x.url) === normalise(s.url); })[0];
        var critical = s.critical || (site && site.critical);
        if (!s.ok) {
          out.push({
            severity: critical ? 'bad' : 'warn',
            kind: 'site',
            title: (s.name || s.url) + ' is failing its check',
            detail: s.error || ('HTTP ' + (s.status || '—') + (s.expectedStatus ? ' (expected ' + s.expectedStatus + ')' : '')),
            route: 'sites'
          });
        } else if (s.ms != null && s.ms > 3000) {
          out.push({
            severity: 'warn', kind: 'site',
            title: (s.name || s.url) + ' is slow',
            detail: 'Responded in ' + PANEL.fmtNum(s.ms) + ' ms',
            route: 'sites'
          });
        }
        if (s.tls && s.tls.daysLeft != null && s.tls.daysLeft <= (c.sslWarnDays || 21)) {
          out.push({
            severity: s.tls.daysLeft <= 7 ? 'bad' : 'warn', kind: 'tls',
            title: 'TLS certificate expiring for ' + (s.name || s.url),
            detail: s.tls.daysLeft + ' day' + (s.tls.daysLeft === 1 ? '' : 's') + ' left (' + (s.tls.validTo || '') + ')',
            route: 'sites'
          });
        }
      });
      if (feed.generatedAt && Date.now() - feed.generatedAt > 6 * 3600000) {
        out.push({
          severity: 'warn', kind: 'feed',
          title: 'Health data is stale',
          detail: 'Last check ' + PANEL.fmtWhen(feed.generatedAt) + ' — the panel-health workflow may have stopped.',
          route: 'sites'
        });
      }
    }

    // --- renewals and trials ---------------------------------------
    var warnDays = c.renewalWarnDays || 14;
    subs.forEach(function (s) {
      var next = PANEL.money.nextCharge(s);
      if (next) {
        var d = PANEL.daysUntil(next);
        if (d != null && d <= warnDays) {
          out.push({
            severity: d <= 2 ? 'bad' : 'warn', kind: 'renewal',
            title: (s.vendor || 'Subscription') + ' renews ' + (d <= 0 ? 'today' : 'in ' + d + ' day' + (d === 1 ? '' : 's')),
            detail: PANEL.money.fmt(s.amount, s.currency) + ' on ' + PANEL.fmtDate(next) +
              (s.autoRenew === false ? ' — auto-renew is OFF, it will lapse' : ''),
            route: 'calendar'
          });
        }
      }
      if (s.status === 'trial' && s.endsOn) {
        var td = PANEL.daysUntil(s.endsOn);
        if (td != null && td <= 7) {
          out.push({
            severity: td <= 1 ? 'bad' : 'warn', kind: 'trial',
            title: (s.vendor || 'Trial') + ' trial ends ' + (td <= 0 ? 'today' : 'in ' + td + ' days'),
            detail: 'Decide before it converts to ' + PANEL.money.fmt(s.amount, s.currency) + '.',
            route: 'money'
          });
        }
      }
      if (s.category === 'Domain' && s.endsOn) {
        var dd = PANEL.daysUntil(s.endsOn);
        if (dd != null && dd <= 45) {
          out.push({
            severity: dd <= 14 ? 'bad' : 'warn', kind: 'domain',
            title: (s.vendor || 'Domain') + ' registration expires in ' + dd + ' days',
            detail: 'A lapsed domain takes the site with it.',
            route: 'money'
          });
        }
      }
    });

    // --- budget -----------------------------------------------------
    if (c.monthlyBudget > 0) {
      var month = PANEL.money.monthKey(new Date());
      var spent = PANEL.money.spentInMonth(expenses, month);
      if (spent > c.monthlyBudget) {
        out.push({
          severity: 'warn', kind: 'budget',
          title: 'Over budget this month',
          detail: PANEL.money.fmtBase(spent) + ' recorded against a ' + PANEL.money.fmtBase(c.monthlyBudget) + ' budget.',
          route: 'money'
        });
      }
    }

    // --- open incidents ---------------------------------------------
    PANEL.get('incidents').forEach(function (i) {
      if (i.resolvedAt) return;
      out.push({
        severity: i.severity === 'major' ? 'bad' : 'warn', kind: 'incident',
        title: 'Open incident: ' + (i.title || 'untitled'),
        detail: 'Started ' + PANEL.fmtDate(i.startedAt),
        route: 'ops'
      });
    });

    var rank = { bad: 0, warn: 1 };
    return out.sort(function (a, b) { return rank[a.severity] - rank[b.severity]; });
  }

  return {
    fetch: fetchHealth, bySiteUrl: bySiteUrl, normalise: normalise,
    uptime: uptime, ping: ping, build: build,
    get data() { return data; }
  };
})();
