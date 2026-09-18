// Stryker Trading Academy — X autopost admin
// Depends on: assets/auth.js, assets/progress.js (db), firebase-functions-compat
//
// The page is a window onto two things the server owns:
//
//   xAutopost/config   settings the tick reads on every run (no secrets here —
//                      keys live in Secret Manager; this doc is readable by
//                      every admin's browser)
//   xPosts/{id}        the queue, one document per post, status-driven
//
// Nothing on this page talks to X. Approving a post is a status change on its
// document; the scheduled function picks it up within ten minutes. The only
// server calls are the callable's admin actions: test credentials, run the
// tick now, redraft a post, render a card preview.
//
// WHY LIVE LISTENERS: the queue changes underneath the admin — a tick drafts
// a feature promo while they are reading, a post goes out. A page that needs
// a reload to notice is a page that shows an approve button for something
// already posted.

var XP = { posts: [], config: null, state: null, tab: 'queued', unsubs: [] };

var KIND_LABEL = {
  brief: 'Brief', calendar: 'Calendar', monitor: 'Monitor',
  announce: 'Announcement', feature: 'Feature', manual: 'Manual'
};

var TABS = [
  ['queued',   'Needs approval', ['queued']],
  ['upcoming', 'Scheduled',      ['approved', 'ready', 'posting']],
  ['posted',   'Posted',         ['posted']],
  ['problems', 'Failed & skipped', ['failed', 'skipped', 'rejected']]
];

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function fmtWhen(ms) {
  if (!ms) return '—';
  var d = new Date(ms);
  var diff = ms - Date.now();
  var abs = Math.abs(diff);
  var rel;
  if (abs < 60000) rel = 'now';
  else if (abs < 3600000) rel = Math.round(abs / 60000) + 'm';
  else if (abs < 86400000) rel = Math.round(abs / 3600000) + 'h';
  else rel = Math.round(abs / 86400000) + 'd';
  rel = diff < 0 ? rel + ' ago' : 'in ' + rel;
  return d.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) +
         ' <span class="xp-rel">(' + rel + ')</span>';
}

function fns() {
  try { return firebase.app().functions(); } catch (e) { return null; }
}

function callAdmin(action, extra) {
  var f = fns();
  if (!f) return Promise.reject(new Error('Functions SDK not loaded.'));
  return f.httpsCallable('xAutopostAdmin')(Object.assign({ action: action }, extra || {}))
    .then(function (r) { return r.data; });
}

// ---- Settings ------------------------------------------------------------------

var CONFIG_FIELDS = [
  { key: 'handle', label: 'Account handle', type: 'text', placeholder: 'without the @',
    help: 'Only used to build the link to each post once it is live.' },
  { key: 'briefHourUtc', label: 'Brief thread at (UTC hour)', type: 'number', min: 0, max: 23, def: 6 },
  { key: 'briefMinuteUtc', label: 'Brief thread at (UTC minute)', type: 'number', min: 0, max: 59, def: 30,
    help: 'Weekdays only, and only once the day’s brief has landed. 06:30 is an hour after the refresh and thirty minutes before London.' },
  { key: 'calendarLeadMinutes', label: 'Calendar alert lead (minutes)', type: 'number', min: 15, max: 120, def: 30,
    help: 'High-impact events only. Posted this many minutes before the release; never after it.' },
  { key: 'featureHourUtc', label: 'Feature promo drafted at (UTC hour)', type: 'number', min: 0, max: 23, def: 14,
    help: 'One per day, rotating through the features pages. It waits here for your approval.' },
  { key: 'announceDelayMinutes', label: 'Announce new content after (minutes)', type: 'number', min: 5, max: 1440, def: 30,
    help: 'Time for you to finish editing a chapter, model, indicator or session before it is announced. The title is re-read at posting time.' },
  { key: 'minGapMinutes', label: 'Minimum gap between posts (minutes)', type: 'number', min: 10, max: 720, def: 45,
    help: 'Calendar alerts ignore the gap — they are worthless late.' },
  { key: 'maxPerDay', label: 'Maximum posts per day', type: 'number', min: 1, max: 20, def: 5,
    help: 'A thread counts once. The X Free tier has a monthly write cap; five a day stays under it.' },
  { key: 'monitorMaxPerDay', label: 'Maximum monitor alerts per day', type: 'number', min: 0, max: 10, def: 2 },
  { key: 'cards', label: 'Attach image cards', type: 'bool', def: true,
    help: 'A branded 1200×675 card on every post. Turn off if the server renderer is unavailable.' }
];

function renderConfig() {
  var host = document.getElementById('xp-config');
  if (!host) return;
  var cfg = XP.config || {};
  host.innerHTML = CONFIG_FIELDS.map(function (f) {
    var v = cfg[f.key] === undefined || cfg[f.key] === null ? f.def : cfg[f.key];
    var id = 'xp-c-' + f.key;
    var input;
    if (f.type === 'bool') {
      input = '<label class="bot-switch"><input type="checkbox" id="' + id + '"' + (v ? ' checked' : '') + '><span></span></label>';
    } else if (f.type === 'number') {
      input = '<input type="number" id="' + id + '" class="input" value="' + esc(v) + '" min="' + f.min + '" max="' + f.max + '">';
    } else {
      input = '<input type="text" id="' + id + '" class="input" value="' + esc(v || '') + '" placeholder="' + esc(f.placeholder || '') + '">';
    }
    return '<div class="bot-field' + (f.type === 'bool' ? ' is-bool' : '') + '">' +
      '<label for="' + id + '">' + esc(f.label) + '</label>' + input +
      (f.help ? '<p class="bot-help">' + esc(f.help) + '</p>' : '') + '</div>';
  }).join('');
}

function saveConfig() {
  var out = {};
  CONFIG_FIELDS.forEach(function (f) {
    var el = document.getElementById('xp-c-' + f.key);
    if (!el) return;
    if (f.type === 'bool') out[f.key] = el.checked;
    else if (f.type === 'number') {
      var n = parseInt(el.value, 10);
      out[f.key] = isNaN(n) ? f.def : Math.min(f.max, Math.max(f.min, n));
    } else out[f.key] = el.value.trim().replace(/^@/, '');
  });
  return db.collection('xAutopost').doc('config').set(out, { merge: true }).then(function () {
    if (typeof logActivity === 'function') logActivity('x.config', 'Updated X autopost settings');
    if (typeof showToast === 'function') showToast('success', 'Settings saved. They apply on the next tick.');
  }).catch(function (err) {
    if (typeof showToast === 'function') showToast('error', err.message || 'Could not save.');
  });
}

function setEnabled(on) {
  return db.collection('xAutopost').doc('config').set({ enabled: !!on }, { merge: true }).then(function () {
    if (typeof logActivity === 'function') logActivity('x.toggled', (on ? 'Enabled' : 'Paused') + ' X autopost');
  });
}

// ---- Status strip ---------------------------------------------------------------

function renderStatus() {
  var host = document.getElementById('xp-status');
  if (!host) return;
  var cfg = XP.config || {};
  var st = XP.state || {};
  var today = new Date().toISOString().slice(0, 10);
  var count = st.postDay === today ? (st.postCount || 0) : 0;
  var pill = document.getElementById('xp-enabled-pill');
  if (pill) {
    pill.className = 'bot-status ' + (cfg.enabled ? (st.lastError ? 'error' : 'ok') : 'paused');
    pill.textContent = cfg.enabled ? (st.lastError ? 'Running · last post failed' : 'Running') : 'Paused';
  }
  var btn = document.getElementById('xp-toggle-btn');
  if (btn) btn.textContent = cfg.enabled ? 'Pause posting' : 'Enable posting';

  host.innerHTML =
    '<div><span>Last tick</span><b>' + (st.lastTickAtMs ? fmtWhen(st.lastTickAtMs) : 'never') + '</b></div>' +
    '<div><span>Last post</span><b>' + (st.lastPostAtMs ? fmtWhen(st.lastPostAtMs) : 'never') + '</b></div>' +
    '<div><span>Posted today</span><b>' + count + ' / ' + (cfg.maxPerDay || 5) + '</b></div>' +
    '<div><span>Waiting for approval</span><b>' + XP.posts.filter(function (p) { return p.status === 'queued'; }).length + '</b></div>' +
    (st.lastError
      ? '<div class="xp-status-err"><span>Last error</span><b>' + esc(st.lastError) + '</b></div>'
      : '');
}

// ---- Queue -----------------------------------------------------------------------

function tabFor(status) {
  for (var i = 0; i < TABS.length; i++) if (TABS[i][2].indexOf(status) >= 0) return TABS[i][0];
  return 'problems';
}

function renderTabs() {
  var host = document.getElementById('xp-tabs');
  if (!host) return;
  host.innerHTML = TABS.map(function (t) {
    var n = XP.posts.filter(function (p) { return t[2].indexOf(p.status) >= 0; }).length;
    return '<button type="button" data-tab="' + t[0] + '"' + (XP.tab === t[0] ? ' class="active"' : '') + '>' +
           esc(t[1]) + (n ? ' <span class="xp-count">' + n + '</span>' : '') + '</button>';
  }).join('');
}

function cardImg(p) {
  if (!p.cardSvg) return '';
  var src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(p.cardSvg);
  return '<img class="xp-card" src="' + src + '" alt="' + esc(p.altText || 'Card preview') + '" ' +
         'title="Browser preview — fonts differ slightly from the server render">';
}

function renderPost(p) {
  var editable = p.status === 'queued' || p.status === 'approved' || p.status === 'failed';
  var parts = p.parts || [];
  var body;
  if (!parts.length) {
    body = '<p class="xp-pending">' + (p.status === 'ready' ? 'Waiting to be drafted on the next tick.' : 'No text.') + '</p>';
  } else if (editable) {
    body = parts.map(function (t, i) {
      return '<div class="xp-part"><textarea class="input xp-text" data-idx="' + i + '" rows="3">' + esc(t) + '</textarea>' +
             '<span class="xp-len" data-for="' + i + '"></span></div>';
    }).join('');
  } else {
    body = parts.map(function (t) { return '<p class="xp-part-ro">' + esc(t).replace(/\n/g, '<br>') + '</p>'; }).join('');
  }

  var when;
  if (p.status === 'posted') when = 'Posted ' + fmtWhen(p.postedAtMs);
  else if (p.status === 'queued') when = 'Will post once approved' + (p.expiresAtMs ? ' · expires ' + fmtWhen(p.expiresAtMs) : '');
  else if (p.status === 'approved') when = 'Posts ' + fmtWhen(Math.max(p.scheduledForMs || 0, Date.now()));
  else if (p.status === 'ready') when = 'Drafts ' + fmtWhen(Math.max(p.notBeforeMs || 0, Date.now()));
  else when = esc(p.status);

  var actions = [];
  if (p.status === 'queued') {
    actions.push('<button type="button" class="btn btn-primary btn-sm" data-act="approve">Approve</button>');
    actions.push('<button type="button" class="btn btn-ghost btn-sm" data-act="post-now">Approve &amp; post next</button>');
  }
  if (p.status === 'approved') {
    actions.push('<button type="button" class="btn btn-ghost btn-sm" data-act="save">Save edits</button>');
    actions.push('<button type="button" class="btn btn-ghost btn-sm" data-act="post-now">Post next</button>');
    actions.push('<button type="button" class="btn btn-ghost btn-sm" data-act="hold">Hold for approval</button>');
  }
  if (p.status === 'failed') {
    actions.push('<button type="button" class="btn btn-primary btn-sm" data-act="retry">Retry</button>');
  }
  if (p.status !== 'posted' && p.status !== 'posting' && p.kind !== 'manual') {
    actions.push('<button type="button" class="btn btn-ghost btn-sm" data-act="redraft">Redraft</button>');
  }
  if (p.status !== 'posted' && p.status !== 'posting' && p.status !== 'rejected') {
    actions.push('<button type="button" class="btn btn-ghost btn-sm bot-danger" data-act="reject">Reject</button>');
  }
  if (p.status === 'posted' && p.url) {
    actions.push('<a class="btn btn-ghost btn-sm" href="' + esc(p.url) + '" target="_blank" rel="noopener noreferrer">View on X</a>');
  }
  if (p.status === 'rejected' || p.status === 'skipped' || p.status === 'posted') {
    actions.push('<button type="button" class="btn btn-ghost btn-sm bot-danger" data-act="delete">Delete</button>');
  }

  return '<div class="bot-card xp-post" data-id="' + esc(p.id) + '">' +
    '<div class="bot-card-head">' +
      '<span class="xp-kind xp-kind-' + esc(p.kind) + '">' + esc(KIND_LABEL[p.kind] || p.kind) + '</span>' +
      '<div class="bot-card-title"><h3>' + esc(p.title || p.sourceLabel || p.id) + '</h3>' +
        '<span class="bot-type">' + esc(p.sourceLabel || '') + (p.auto === false ? ' · needs approval' : '') + '</span></div>' +
      '<span class="bot-status ' + statusClass(p.status) + '">' + esc(statusText(p.status)) + '</span>' +
    '</div>' +
    '<div class="xp-body">' +
      '<div class="xp-parts">' + body +
        (p.link ? '<p class="xp-link">' + esc(p.link) + '</p>' : '') +
      '</div>' +
      cardImg(p) +
    '</div>' +
    (p.error ? '<div class="bot-error"><b>' + (p.status === 'failed' ? 'Error' : 'Note') + '</b><span>' + esc(p.error) + '</span></div>' : '') +
    '<div class="bot-meta xp-meta">' +
      '<div><span>When</span><b>' + when + '</b></div>' +
      (p.draftedBy ? '<div><span>Drafted by</span><b>' + esc(p.draftedBy) + '</b></div>' : '') +
      (p.tweetIds ? '<div><span>Tweets</span><b>' + p.tweetIds.length + (p.hadCard ? ' · with card' : ' · text only') + '</b></div>' : '') +
    '</div>' +
    '<div class="bot-card-actions">' + actions.join('') + '</div>' +
  '</div>';
}

function statusClass(s) {
  if (s === 'posted' || s === 'approved') return 'ok';
  if (s === 'failed') return 'error';
  if (s === 'queued' || s === 'ready' || s === 'posting') return 'pending';
  return 'paused';
}
function statusText(s) {
  return { ready: 'Awaiting draft', queued: 'Needs approval', approved: 'Scheduled', posting: 'Posting…',
           posted: 'Posted', failed: 'Failed', rejected: 'Rejected', skipped: 'Skipped' }[s] || s;
}

function renderQueue() {
  renderTabs();
  var host = document.getElementById('xp-list');
  if (!host) return;
  var tab = TABS.filter(function (t) { return t[0] === XP.tab; })[0];
  var rows = XP.posts.filter(function (p) { return tab[2].indexOf(p.status) >= 0; });
  if (!rows.length) {
    host.innerHTML = '<div class="empty-state"><h3>Nothing here</h3><p>' + {
      queued: 'Feature promos land here once a day for you to approve. Everything else posts on its own.',
      upcoming: 'Drafts waiting for their slot appear here. The brief is enqueued each weekday morning.',
      posted: 'Nothing has been posted yet.',
      problems: 'No failures, rejections or missed windows.'
    }[XP.tab] + '</p></div>';
    return;
  }
  host.innerHTML = rows.map(renderPost).join('');
  host.querySelectorAll('.xp-text').forEach(updateLen);
}

// X's weighted count: URLs are 23, most characters 1, CJK and emoji 2. The
// server enforces it; this only shows it as you type.
function weightedLen(text) {
  var s = String(text || '').replace(/https?:\/\/[^\s]+/g, function () { return 'xxxxxxxxxxxxxxxxxxxxxxx'; });
  var n = 0;
  for (var i = 0; i < s.length; i++) {
    var cp = s.codePointAt(i);
    if (cp > 0xffff) i++;
    n += cp > 0x1100 ? 2 : 1;
  }
  return n;
}

function updateLen(ta) {
  var card = ta.closest('.xp-post');
  var p = XP.posts.filter(function (x) { return x.id === card.dataset.id; })[0];
  var isLast = parseInt(ta.dataset.idx, 10) === (p.parts || []).length - 1;
  var n = weightedLen(ta.value) + (isLast && p.link ? 25 : 0);
  var el = card.querySelector('.xp-len[data-for="' + ta.dataset.idx + '"]');
  if (el) {
    el.textContent = n + ' / 280' + (isLast && p.link ? ' incl. link' : '');
    el.className = 'xp-len' + (n > 280 ? ' over' : '');
  }
}

function readParts(card) {
  var out = [];
  card.querySelectorAll('.xp-text').forEach(function (ta) { out[parseInt(ta.dataset.idx, 10)] = ta.value.trim(); });
  return out.filter(Boolean);
}

function act(post, action, card) {
  var ref = db.collection('xPosts').doc(post.id);
  var edited = card ? readParts(card) : null;
  var over = (edited || []).some(function (t, i) {
    return weightedLen(t) + (i === edited.length - 1 && post.link ? 25 : 0) > 280;
  });
  if (over && (action === 'approve' || action === 'post-now' || action === 'save' || action === 'retry')) {
    if (typeof showToast === 'function') showToast('error', 'One of the posts is over 280 characters.');
    return;
  }
  var upd = { updatedAt: firebase.firestore.FieldValue.serverTimestamp() };
  if (edited && edited.length) upd.parts = edited;

  var p;
  if (action === 'approve') { upd.status = 'approved'; upd.approvedBy = auth.currentUser.uid; p = ref.set(upd, { merge: true }); }
  else if (action === 'post-now') { upd.status = 'approved'; upd.scheduledForMs = 0; upd.approvedBy = auth.currentUser.uid; p = ref.set(upd, { merge: true }); }
  else if (action === 'save') { p = ref.set(upd, { merge: true }); }
  else if (action === 'hold') { upd.status = 'queued'; p = ref.set(upd, { merge: true }); }
  else if (action === 'retry') { upd.status = 'approved'; upd.error = null; upd.scheduledForMs = 0; p = ref.set(upd, { merge: true }); }
  else if (action === 'reject') {
    if (!confirm('Reject this post? It will not be drafted again for this item.')) return;
    upd.status = 'rejected'; p = ref.set(upd, { merge: true });
  }
  else if (action === 'delete') {
    if (!confirm('Delete this record? If the item is still current it may be enqueued again.')) return;
    p = ref.delete();
  }
  else if (action === 'redraft') {
    p = callAdmin('redraft', { id: post.id }).then(function () {
      if (typeof showToast === 'function') showToast('success', 'Redrafted.');
    });
  }
  if (!p) return;
  p.then(function () {
    if (typeof logActivity === 'function') logActivity('x.post.' + action, action + ': ' + (post.title || post.id));
  }).catch(function (err) {
    if (typeof showToast === 'function') showToast('error', err.message || 'Could not update.');
  });
}

// ---- Composer --------------------------------------------------------------------

function openComposer() {
  document.getElementById('xp-compose-overlay').style.display = 'flex';
  document.getElementById('xp-compose-text').value = '';
  document.getElementById('xp-compose-link').value = '';
  document.getElementById('xp-compose-card').value = '';
  updateComposeLen();
}
function closeComposer() { document.getElementById('xp-compose-overlay').style.display = 'none'; }

function updateComposeLen() {
  var text = document.getElementById('xp-compose-text').value;
  var link = document.getElementById('xp-compose-link').value.trim();
  var n = weightedLen(text) + (link ? 25 : 0);
  var el = document.getElementById('xp-compose-len');
  el.textContent = n + ' / 280' + (link ? ' incl. link' : '');
  el.className = 'xp-len' + (n > 280 ? ' over' : '');
}

function submitComposer() {
  var text = document.getElementById('xp-compose-text').value.trim();
  var link = document.getElementById('xp-compose-link').value.trim();
  var cardTitle = document.getElementById('xp-compose-card').value.trim();
  if (!text) { if (typeof showToast === 'function') showToast('error', 'Write something first.'); return; }
  if (link && !/^https?:\/\//.test(link)) { if (typeof showToast === 'function') showToast('error', 'The link must start with http:// or https://'); return; }
  if (weightedLen(text) + (link ? 25 : 0) > 280) { if (typeof showToast === 'function') showToast('error', 'Over 280 characters.'); return; }

  var id = 'man-' + Date.now();
  db.collection('xPosts').doc(id).set({
    kind: 'manual', auto: true, status: 'approved',
    title: text.split('\n')[0].slice(0, 80),
    sourceLabel: 'Written by ' + ((auth.currentUser && auth.currentUser.email) || 'admin'),
    parts: [text], link: link || null,
    cardTitle: cardTitle || null, eyebrow: cardTitle ? 'Stryker Trading Academy' : null,
    scheduledForMs: 0, expiresAtMs: Date.now() + 7 * 86400000,
    createdAtMs: Date.now(),
    createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    createdBy: auth.currentUser.uid, error: null, tweetIds: null
  }).then(function () {
    if (typeof logActivity === 'function') logActivity('x.post.manual', 'Queued a manual X post');
    if (typeof showToast === 'function') showToast('success', 'Queued. It posts on the next tick, pacing allowing.');
    closeComposer();
  }).catch(function (err) {
    if (typeof showToast === 'function') showToast('error', err.message || 'Could not queue.');
  });
}

// ---- Data -----------------------------------------------------------------------

function subscribe() {
  XP.unsubs.push(db.collection('xAutopost').doc('config').onSnapshot(function (d) {
    XP.config = d.exists ? d.data() : {};
    renderConfig(); renderStatus();
  }, function (err) { console.error('x-admin config:', err); }));

  XP.unsubs.push(db.collection('xAutopost').doc('state').onSnapshot(function (d) {
    XP.state = d.exists ? d.data() : {};
    renderStatus();
  }, function (err) { console.error('x-admin state:', err); }));

  XP.unsubs.push(db.collection('xPosts').orderBy('createdAtMs', 'desc').limit(200).onSnapshot(function (snap) {
    XP.posts = [];
    snap.forEach(function (d) { var p = d.data(); p.id = d.id; XP.posts.push(p); });
    // Queue tab shows the oldest first — that is the order they will post.
    renderQueue(); renderStatus();
  }, function (err) {
    var host = document.getElementById('xp-list');
    if (host) host.innerHTML = '<div class="empty-state"><h3>Could not load the queue</h3><p>' + esc(err.message) + '</p></div>';
  }));
}

// ---- Wiring ----------------------------------------------------------------------

document.addEventListener('DOMContentLoaded', function () {
  if (!document.getElementById('xp-list')) return;

  document.getElementById('xp-tabs').addEventListener('click', function (e) {
    var b = e.target.closest('[data-tab]');
    if (!b) return;
    XP.tab = b.dataset.tab;
    renderQueue();
  });

  document.getElementById('xp-list').addEventListener('click', function (e) {
    var btn = e.target.closest('[data-act]');
    if (!btn) return;
    var card = btn.closest('.xp-post');
    var post = XP.posts.filter(function (p) { return p.id === card.dataset.id; })[0];
    if (post) act(post, btn.dataset.act, card);
  });
  document.getElementById('xp-list').addEventListener('input', function (e) {
    if (e.target.classList.contains('xp-text')) updateLen(e.target);
  });

  document.getElementById('xp-config-save').addEventListener('click', saveConfig);
  document.getElementById('xp-toggle-btn').addEventListener('click', function () {
    var on = !(XP.config && XP.config.enabled);
    if (on && !confirm('Enable automatic posting to X?\n\nThe brief, calendar alerts, monitor alerts and announcements will post without approval. Feature promos still wait for you.')) return;
    setEnabled(on);
  });

  document.getElementById('xp-run-btn').addEventListener('click', function (e) {
    var b = e.currentTarget; b.disabled = true; b.textContent = 'Running…';
    callAdmin('tick').then(function (r) {
      if (typeof showToast === 'function') showToast(r.ran ? 'success' : 'error', r.ran ? 'Tick complete.' : 'Autopost is paused; enable it first.');
    }).catch(function (err) {
      if (typeof showToast === 'function') showToast('error', err.message || 'Run failed.');
    }).then(function () { b.disabled = false; b.textContent = 'Run now'; });
  });

  document.getElementById('xp-test-btn').addEventListener('click', function (e) {
    var b = e.currentTarget; b.disabled = true; b.textContent = 'Testing…';
    callAdmin('whoami').then(function (r) {
      if (r.ok) {
        var msg = 'Connected as @' + (r.user && r.user.username) +
          (r.anthropic ? '' : ' — ANTHROPIC_API_KEY is missing') +
          (r.cards ? '' : ' — card renderer not installed');
        if (typeof showToast === 'function') showToast((r.anthropic && r.cards) ? 'success' : 'error', msg);
      } else {
        if (typeof showToast === 'function') showToast('error', r.error || 'Not connected.');
      }
    }).catch(function (err) {
      if (typeof showToast === 'function') showToast('error', err.message || 'Test failed.');
    }).then(function () { b.disabled = false; b.textContent = 'Test connection'; });
  });

  document.getElementById('xp-compose-btn').addEventListener('click', openComposer);
  document.getElementById('xp-compose-close').addEventListener('click', closeComposer);
  document.getElementById('xp-compose-cancel').addEventListener('click', closeComposer);
  document.getElementById('xp-compose-send').addEventListener('click', submitComposer);
  document.getElementById('xp-compose-text').addEventListener('input', updateComposeLen);
  document.getElementById('xp-compose-link').addEventListener('input', updateComposeLen);

  document.querySelectorAll('[data-xp-toggle]').forEach(function (h) {
    h.addEventListener('click', function () {
      var body = document.getElementById(h.dataset.xpToggle);
      var open = body.style.display !== 'none';
      body.style.display = open ? 'none' : '';
      h.setAttribute('aria-expanded', String(!open));
    });
  });

  if (typeof auth !== 'undefined' && auth) {
    var done = false;
    auth.onAuthStateChanged(function (user) {
      if (done || !user) return;
      done = true;
      subscribe();
    });
  }
});
