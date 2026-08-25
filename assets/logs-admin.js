// Stryker Trading Academy — Admin: Activity log (logs-admin.html)
// Depends on: assets/auth.js, assets/progress.js (db), assets/admin-guard.js,
//             assets/activity-log.js (ACTIVITY_ACTIONS)

let ALL_LOGS = [];
const LOG_PAGE_SIZE = 100;
let LOG_SHOWN = LOG_PAGE_SIZE;

// Log entries carry free text written by users — post excerpts, moderation
// reasons, display names. It is stored RAW so other consumers get the real
// value, which means it must be escaped here, at the point it becomes HTML.
function escapeLogText(s){
  return String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function roleTagFor(role){
  const map = {
    admin:     { label: 'Admin',     color: '#03c988', bg: 'rgba(3,201,136,0.12)' },
    moderator: { label: 'Moderator', color: '#00adb5', bg: 'rgba(0,173,181,0.12)' },
    student:   { label: 'Student',   color: '#8b93a0', bg: 'rgba(139,147,160,0.12)' }
  };
  const m = map[role] || map.student;
  return '<span style="font-family:var(--font-mono); font-size:10.5px; padding:2px 7px; border-radius:5px; ' +
         'color:' + m.color + '; background:' + m.bg + '; margin-left:7px;">' + m.label + '</span>';
}

function formatLogTime(ts){
  if (!ts || typeof ts.toDate !== 'function') return '—';
  const d = ts.toDate();
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) +
         ' · ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function currentFilters(){
  return {
    actor: document.getElementById('log-filter-user').value,
    action: document.getElementById('log-filter-action').value,
    from: document.getElementById('log-filter-from').value,
    to: document.getElementById('log-filter-to').value
  };
}

function applyLogFilters(){
  const f = currentFilters();
  // Date inputs are plain dates; "to" is inclusive, so compare against the END
  // of that day rather than midnight at its start — otherwise picking the same
  // day for both bounds returns nothing.
  const fromMs = f.from ? new Date(f.from + 'T00:00:00').getTime() : null;
  const toMs = f.to ? new Date(f.to + 'T23:59:59').getTime() : null;

  return ALL_LOGS.filter((l) => {
    if (f.actor && l.actorUid !== f.actor) return false;
    if (f.action && l.action !== f.action) return false;
    if (fromMs || toMs) {
      const t = (l.createdAt && l.createdAt.toMillis) ? l.createdAt.toMillis() : null;
      if (t === null) return false;          // unresolved server timestamp
      if (fromMs && t < fromMs) return false;
      if (toMs && t > toMs) return false;
    }
    return true;
  });
}

function renderLogs(){
  const list = applyLogFilters();
  const wrap = document.getElementById('log-list');
  const countEl = document.getElementById('log-count');

  if (countEl) {
    countEl.textContent = list.length + ' entr' + (list.length === 1 ? 'y' : 'ies') +
      (list.length !== ALL_LOGS.length ? ' of ' + ALL_LOGS.length : '');
  }

  if (!list.length) {
    wrap.innerHTML = '<p style="color:var(--ink-3); font-size:13.5px; padding:16px;">No activity matches these filters.</p>';
    document.getElementById('log-more-wrap').style.display = 'none';
    return;
  }

  const page = list.slice(0, LOG_SHOWN);
  wrap.innerHTML = '';

  page.forEach((l) => {
    const card = document.createElement('div');
    card.className = 'record-card';
    card.style.alignItems = 'flex-start';
    card.innerHTML =
      '<div style="flex:1; min-width:0;">' +
        '<span class="cell-name">' + escapeLogText(l.actorName || 'Unknown') + roleTagFor(l.actorRole) + '</span>' +
        '<div style="font-size:13px; color:var(--ink-1); margin-top:4px; word-break:break-word;">' +
          escapeLogText(l.summary || l.action) + '</div>' +
        (l.detail ? '<div style="font-family:var(--font-mono); font-size:11.5px; color:var(--ink-3); margin-top:4px; word-break:break-word;">' +
          escapeLogText(l.detail) + '</div>' : '') +
      '</div>' +
      '<div style="font-family:var(--font-mono); font-size:11.5px; color:var(--ink-3); text-align:right; white-space:nowrap; margin-left:12px;">' +
        formatLogTime(l.createdAt) + '</div>';
    wrap.appendChild(card);
  });

  const moreWrap = document.getElementById('log-more-wrap');
  if (list.length > LOG_SHOWN) {
    moreWrap.style.display = 'block';
    document.getElementById('log-more-btn').textContent =
      'Show more (' + (list.length - LOG_SHOWN) + ' left)';
  } else {
    moreWrap.style.display = 'none';
  }
}

// The "by user" dropdown is built from whoever actually appears in the log,
// rather than the full student list — a filter offering hundreds of people who
// have never done anything is worse than useless on a phone.
function populateActorFilter(){
  const sel = document.getElementById('log-filter-user');
  const seen = new Map();
  ALL_LOGS.forEach((l) => {
    if (l.actorUid && !seen.has(l.actorUid)) seen.set(l.actorUid, l.actorName || 'Unknown');
  });
  const sorted = Array.from(seen.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  sel.innerHTML = '<option value="">All users</option>' +
    sorted.map(([uid, name]) => '<option value="' + escapeLogText(uid) + '">' + escapeLogText(name) + '</option>').join('');
}

function populateActionFilter(){
  const sel = document.getElementById('log-filter-action');
  const present = new Set(ALL_LOGS.map((l) => l.action));
  const opts = Object.keys(ACTIVITY_ACTIONS)
    .filter((k) => present.has(k))
    .map((k) => '<option value="' + k + '">' + ACTIVITY_ACTIONS[k] + '</option>');
  sel.innerHTML = '<option value="">All actions</option>' + opts.join('');
}

function loadLogs(){
  const wrap = document.getElementById('log-list');
  wrap.innerHTML = '<p style="color:var(--ink-3); font-size:13.5px; padding:16px;">Loading…</p>';

  // Capped at 2000. The whole point of the purge controls is to stop this
  // collection growing without limit; pulling everything unbounded would make
  // the page slower the longer the site runs.
  db.collection('activityLog').orderBy('createdAt', 'desc').limit(2000).get()
    .then((snap) => {
      ALL_LOGS = [];
      snap.forEach((doc) => ALL_LOGS.push(Object.assign({ id: doc.id }, doc.data())));
      LOG_SHOWN = LOG_PAGE_SIZE;
      populateActorFilter();
      populateActionFilter();
      renderLogs();
    })
    .catch((err) => {
      wrap.innerHTML = '<p style="color:var(--bear); font-size:13.5px; padding:16px;">Could not load the log: ' +
        escapeLogText(err.message || err) + '</p>';
    });
}

// Deletes everything older than `days`, or everything when days is 0.
function purgeLogs(days, label){
  const cutoff = days > 0 ? Date.now() - (days * 86400000) : null;

  const doomed = ALL_LOGS.filter((l) => {
    if (cutoff === null) return true;
    const t = (l.createdAt && l.createdAt.toMillis) ? l.createdAt.toMillis() : 0;
    return t < cutoff;
  });

  if (!doomed.length) { showToast('error', 'Nothing to delete — no entries ' + label + '.'); return; }
  if (!confirm('Delete ' + doomed.length + ' log entr' + (doomed.length === 1 ? 'y' : 'ies') + ' ' + label + '?\n\nThis cannot be undone.')) return;

  const btnWrap = document.getElementById('log-purge-actions');
  btnWrap.querySelectorAll('button').forEach((b) => { b.disabled = true; });

  const batches = [];
  for (let i = 0; i < doomed.length; i += 400) {
    const batch = db.batch();
    doomed.slice(i, i + 400).forEach((l) => batch.delete(db.collection('activityLog').doc(l.id)));
    batches.push(batch.commit());
  }

  Promise.all(batches)
    .then(() => {
      // Logged after the fact, so the purge itself survives the purge.
      if (typeof logActivity === 'function') {
        return logActivity('log.purged', 'Deleted ' + doomed.length + ' log entries (' + label + ')');
      }
    })
    .then(() => {
      showToast('success', 'Deleted ' + doomed.length + ' entries.');
      btnWrap.querySelectorAll('button').forEach((b) => { b.disabled = false; });
      loadLogs();
    })
    .catch((err) => {
      showToast('error', 'Could not purge: ' + (err.message || err));
      btnWrap.querySelectorAll('button').forEach((b) => { b.disabled = false; });
    });
}

document.addEventListener('DOMContentLoaded', () => {
  guardAdminPage(() => loadLogs());

  ['log-filter-user', 'log-filter-action', 'log-filter-from', 'log-filter-to'].forEach((id) => {
    document.getElementById(id).addEventListener('change', () => {
      LOG_SHOWN = LOG_PAGE_SIZE;
      renderLogs();
    });
  });

  document.getElementById('log-filter-reset').addEventListener('click', () => {
    ['log-filter-user', 'log-filter-action', 'log-filter-from', 'log-filter-to'].forEach((id) => {
      document.getElementById(id).value = '';
    });
    LOG_SHOWN = LOG_PAGE_SIZE;
    renderLogs();
  });

  document.getElementById('log-more-btn').addEventListener('click', () => {
    LOG_SHOWN += LOG_PAGE_SIZE;
    renderLogs();
  });

  document.querySelectorAll('[data-purge-days]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const days = parseInt(btn.getAttribute('data-purge-days'), 10);
      purgeLogs(days, days > 0 ? ('older than ' + days + ' days') : 'in the entire log');
    });
  });
});
