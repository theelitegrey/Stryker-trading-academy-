// TradeZoro: Partners admin (partners-admin.html). Admin only. Reads partners/*, partners/*/weeks/*, students/{uid} (name).
// Every change goes through the callable partnerAdmin (server writes status, proUntil and the Pro grant).
(function () {
  'use strict';
  var PT = window.PartnerTerms, T = PT.PARTNER_TERMS, DAY = 864e5;
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return window.stkEsc ? window.stkEsc(s) : String(s).replace(/[&<>"']/g, function (c) { return '&#' + c.charCodeAt(0) + ';'; }); };
  var TABS = [['pending', 'Pending'], ['active', 'Active'], ['paused', 'Paused'], ['rejected', 'Rejected'], ['closed', 'Ended / left']];
  var rows = [], tab = 'pending', modal = null;

  function fmt(ms) { return ms ? new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '-'; }
  function tabOf(st) { return st === 'ended' || st === 'left' ? 'closed' : (st || 'pending'); }
  function err(msg) { var e = $('pa-error'); e.textContent = msg || ''; e.style.display = msg ? 'block' : 'none'; }
  function safe(u) { return PT.cleanLink(u); }
  function link(u, label) { var s = safe(u); return s ? '<a href="' + esc(s) + '" target="_blank" rel="noopener noreferrer">' + esc(label || s.replace(/^https:\/\//, '')) + '</a>' : ''; }

  function stats(r) {
    var now = Date.now(), key = PT.isoWeekKey(now), wk = r.weeks || {};
    var thisWeek = (wk[key] || []).length;
    var miss = r.status === 'active' || r.status === 'paused' ? PT.missedWeeks(wk, r.approvedAtMillis, now, T.historyWeeks) : [];
    var lastMonth = miss.filter(function (k) { return miss.indexOf(k) < 4; }).length;
    var left = r.proUntil ? (r.proUntil - now) / DAY : null;
    var due = r.status === 'active' && left !== null && left <= T.reviewDueDays;
    return { thisWeek: thisWeek, miss: miss, lastMonth: lastMonth, left: left, due: due };
  }

  function card(r) {
    var s = stats(r), st = r.status || 'pending', b = [];
    b.push('<span class="pt-badge ' + (st === 'active' ? 'is-ok' : st === 'pending' || st === 'paused' ? 'is-warn' : 'is-bad') + '">' + esc(st) + '</span>');
    if (s.due) b.push('<span class="pt-badge is-warn">Due for review</span>');
    if (s.miss.length) b.push('<span class="pt-badge is-bad">Missed ' + s.miss.length + ' week' + (s.miss.length > 1 ? 's' : '') + '</span>');
    if (s.lastMonth >= T.missedWeeksToPause && st === 'active') b.push('<span class="pt-badge is-bad">Pause?</span>');
    if (st === 'pending' && r.followers < T.minFollowers) b.push('<span class="pt-badge is-bad">Under ' + T.minFollowers.toLocaleString('en-US') + ' followers</span>');
    var plat = (T.platforms.filter(function (p) { return p.id === r.platform; })[0] || { name: r.platform }).name;
    var facts = [['Platform', plat], ['Handle', r.handle], ['Followers', Number(r.followers).toLocaleString('en-US')], ['Applied', fmt(r.agreedAtMillis)]];
    if (st === 'active' || st === 'paused') facts.push(['Pro until', fmt(r.proUntil) + (s.left !== null ? ' (' + Math.ceil(s.left) + ' d)' : '')], ['Posts this week', s.thisWeek + '/' + T.postsPerWeek]);
    var wkKeys = Object.keys(r.weeks || {}).sort().reverse().slice(0, T.historyWeeks);
    var weeksHtml = (st === 'active' || st === 'paused') ? '<div class="pa-weeks">' + (wkKeys.length ? wkKeys.map(function (k) {
      var n = r.weeks[k].length; return '<span class="pa-week' + (s.miss.indexOf(k) >= 0 ? ' is-miss' : '') + '">' + esc(k.replace('-', ' ')) + ': ' + n + '</span>';
    }).join('') : '<span class="pt-meta">No weekly links yet</span>') + '</div>' : '';
    var links = '<div class="pa-links">' + link(r.profileUrl, 'Profile') + (r.postLinks || []).map(function (u, i) { return link(u, 'Application post ' + (i + 1)); }).join('') +
      (wkKeys.length ? r.weeks[wkKeys[0]].map(function (u) { return link(u, 'Week ' + wkKeys[0].replace('-', ' ') + ': ' + u.replace(/^https:\/\//, '').slice(0, 40)); }).join('') : '') + '</div>';
    var btns = [];
    var B = function (a, label, cls) { return '<button type="button" class="btn ' + (cls || 'btn-secondary') + '" data-act="' + a + '" data-uid="' + esc(r.uid) + '">' + label + '</button>'; };
    if (st === 'pending') btns.push(B('approve', 'Approve', 'btn-primary'), B('reject', 'Reject', 'btn-secondary pa-btn-danger'));
    if (st === 'active') btns.push(B('renew', 'Renew 1 month', s.due ? 'btn-primary' : 'btn-secondary'), B('pause', 'Pause'), B('end', 'End', 'btn-secondary pa-btn-danger'));
    if (st === 'paused') btns.push(B('approve', 'Resume'), B('end', 'End', 'btn-secondary pa-btn-danger'));
    return '<article class="pa-card"><div class="pa-head"><div><div class="pa-name">' + esc(r.name || r.uid) + '</div><div class="pa-sub">' + esc(r.email || '') + '</div></div><div class="pa-badges">' + b.join('') + '</div></div>' +
      '<dl class="pa-facts">' + facts.map(function (f) { return '<div class="pa-fact"><dt>' + esc(f[0]) + '</dt><dd>' + esc(f[1]) + '</dd></div>'; }).join('') + '</dl>' +
      (r.why ? '<p class="pa-why">' + esc(r.why) + '</p>' : '') + links + weeksHtml +
      (r.reviewNote ? '<p class="pa-sub">Note: ' + esc(r.reviewNote) + '</p>' : '') +
      '<div class="pa-btns">' + btns.join('') + '</div></article>';
  }

  function render() {
    $('pa-tabs').innerHTML = TABS.map(function (t) {
      var n = rows.filter(function (r) { return tabOf(r.status) === t[0]; }).length;
      return '<button type="button" role="tab" class="pa-tab" data-tab="' + t[0] + '" aria-selected="' + (t[0] === tab ? 'true' : 'false') + '">' + t[1] + ' · ' + n + '</button>';
    }).join('');
    var list = rows.filter(function (r) { return tabOf(r.status) === tab; });
    list.sort(function (a, b) { return (stats(b).due - stats(a).due) || (b.agreedAtMillis || 0) - (a.agreedAtMillis || 0); });
    $('pa-list').innerHTML = list.length ? list.map(card).join('') : '<div class="pa-empty">Nothing here.</div>';
  }

  function load() {
    return db.collection('partners').get().then(function (q) {
      var list = [];
      q.forEach(function (d) { var x = d.data() || {}; x.uid = d.id; x.agreedAtMillis = x.agreedAt && x.agreedAt.toMillis ? x.agreedAt.toMillis() : 0; list.push(x); });
      return Promise.all(list.map(function (r) {
        return Promise.all([
          db.collection('students').doc(r.uid).get().then(function (s) { var v = s.exists ? s.data() : {}; r.name = v.displayName || v.name || ''; r.email = v.email || ''; }).catch(function () {}),
          db.collection('partners').doc(r.uid).collection('weeks').get().then(function (w) { r.weeks = {}; w.forEach(function (x) { var l = (x.data() || {}).links; if (Array.isArray(l)) r.weeks[x.id] = l; }); }).catch(function () { r.weeks = {}; })
        ]);
      })).then(function () { rows = list; render(); });
    }).catch(function (x) { console.error('partners load', x); err('Could not load partners: ' + (x.message || x)); $('pa-list').innerHTML = ''; });
  }

  function call(uid, action, note) {
    err('');
    return firebase.app().functions().httpsCallable('partnerAdmin')({ uid: uid, action: action, note: note || '' })
      .then(function () { if (window.showToast) showToast('success', 'Done: ' + action); return load(); })
      .catch(function (x) { console.error(x); err((x && x.message) || 'That did not work.'); throw x; });
  }

  function openModal(uid, action) {
    modal = { uid: uid, action: action };
    var rej = action === 'reject';
    $('pa-modal-title').textContent = rej ? 'Reject application' : action === 'pause' ? 'Pause partner' : 'End partnership';
    $('pa-modal-sub').textContent = (rows.filter(function (r) { return r.uid === uid; })[0] || {}).name || '';
    $('pa-modal-label').textContent = rej ? 'Reason (the member sees this)' : 'Note (the member sees this, optional)';
    $('pa-modal-ok').textContent = rej ? 'Reject' : action === 'pause' ? 'Pause' : 'End';
    $('pa-modal-note').value = ''; $('pa-modal-error').style.display = 'none';
    $('pa-modal').hidden = false; $('pa-modal-note').focus();
  }
  function closeModal() { $('pa-modal').hidden = true; modal = null; }

  document.addEventListener('DOMContentLoaded', function () {
    guardAdminPage(function () {
      load();
      $('pa-tabs').addEventListener('click', function (e) { var t = e.target.closest('[data-tab]'); if (t) { tab = t.getAttribute('data-tab'); render(); } });
      $('pa-list').addEventListener('click', function (e) {
        var b = e.target.closest('[data-act]'); if (!b) return;
        var a = b.getAttribute('data-act'), uid = b.getAttribute('data-uid');
        if (a === 'reject' || a === 'pause' || a === 'end') return openModal(uid, a);
        b.disabled = true; call(uid, a).catch(function () { b.disabled = false; });
      });
      $('pa-modal').addEventListener('click', function (e) { if (e.target === this || e.target.closest('[data-close]')) closeModal(); });
      $('pa-modal-ok').addEventListener('click', function () {
        if (!modal) return;
        var note = $('pa-modal-note').value.trim();
        if (modal.action === 'reject' && !note) { var m = $('pa-modal-error'); m.textContent = 'Give a reason.'; m.style.display = 'block'; return; }
        var m2 = modal; this.disabled = true; var btn = this;
        call(m2.uid, m2.action, note).then(closeModal).catch(function () {}).then(function () { btn.disabled = false; });
      });
    });
  });
})();
