// TradeZoro: Partner page (partner.html). Depends on assets/partner-terms.js, auth.js, progress.js (`db`, `auth`).
// States: no doc -> apply form; pending / rejected / ended / left -> status; active / paused -> checklist + links.
// The page only ever writes the application (once), the weekly links, and calls partnerLeave. It never grants anything.
(function () {
  'use strict';
  var PT = window.PartnerTerms, T = PT.PARTNER_TERMS;
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return window.stkEsc ? window.stkEsc(s) : String(s).replace(/[&<>"']/g, function (c) { return '&#' + c.charCodeAt(0) + ';'; }); };
  var uid = null, doc = null, weeks = {};

  function fmtDate(ms) { return ms ? new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : ''; }
  function num(n) { return Number(n).toLocaleString('en-US'); }
  function show(id, on) { var e = $(id); if (e) e.hidden = !on; }
  function err(id, msg) { var e = $(id); if (!e) return; e.textContent = msg || ''; e.style.display = msg ? 'block' : 'none'; }
  var CHECK = '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 6.2l2.4 2.4 4.6-5"/></svg>';

  // ---- terms copy (every number comes from PARTNER_TERMS) -------------------------------------------
  function termsHtml(full) {
    var names = T.platforms.map(function (p) { return p.name; });
    var who = 'A public ' + names.slice(0, -1).join(', ') + ' or ' + names[names.length - 1] + ' account with at least ' + num(T.minFollowers) + ' followers, posting about trading and markets, and at least ' + T.minAccountMonths + ' months old.';
    var get = ['Pro, free, for as long as you are a partner', 'A Partner badge on your profile', 'Early access to new tools', 'A chance to be featured on TradeZoro\'s socials'];
    var ask = [
      'Keep "' + T.bioLine + '" and the ' + T.link + ' link (your partner link) in the bio of your main platform.',
      'Post about TradeZoro at least ' + T.postsPerWeek + ' times a week (posts, reels, videos or threads), tagging ' + T.handle + '. Stories don\'t count toward the ' + T.postsPerWeek + '.',
      'Label partner posts ' + T.tags.join(' or ') + '.',
      'Never claim profits, win rates or results from using TradeZoro. No financial advice and no "guaranteed" language. No fake reviews, and don\'t name or attack other platforms.',
      'Keep partner posts up for at least ' + T.keepPostsDays + ' days.'
    ];
    var how = [
      'Each week, paste the links to that week\'s posts on this page.',
      'Pro is given one month at a time and renewed after a monthly check.',
      'Miss a week and you get a reminder.',
      'Miss ' + T.missedWeeksToPause + ' weeks in a month, or remove the bio line, and Pro pauses at the end of the paid month. You have ' + T.graceDays + ' days\' grace to fix it.',
      'You can re-apply after ' + T.reapplyDays + ' days.',
      'TradeZoro may end a partnership at any time. You can leave at any time.'
    ];
    var li = function (a) { return a.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join(''); };
    if (full) {
      return '<section><h3>Who can apply</h3><ul><li>' + esc(who) + '</li></ul></section>' +
        '<section><h3>What you get</h3><ul>' + li(get) + '</ul></section>' +
        '<section><h3>What we ask</h3><ol>' + li(ask) + '</ol></section>' +
        '<section><h3>How it\'s checked</h3><ul>' + li(how) + '</ul></section>' +
        '<p>Education only. Not financial advice.</p>';
    }
    return '<div class="panel"><h3>Who can apply</h3><p class="pt-lead">' + esc(who) + '</p></div><div class="pt-terms">' +
      '<div class="panel"><h3>What you get</h3><ul>' + li(get) + '</ul></div>' +
      '<div class="panel"><h3>What we ask</h3><ul>' + li(ask) + '</ul></div>' +
      '<div class="panel"><h3>How it\'s checked</h3><ul>' + li(how) + '</ul></div></div>';
  }

  // ---- view -----------------------------------------------------------------------------------------
  function badge(el, text, cls) { el.textContent = text; el.className = 'pt-badge ' + (cls || ''); el.hidden = !text; }

  function render() {
    show('pt-loading', false);
    show('pt-apply', false); show('pt-status', false); show('pt-active', false);
    var top = $('pt-badge');
    if (!doc) { badge(top, '', ''); $('pt-terms').innerHTML = termsHtml(false); show('pt-apply', true); return; }
    var st = doc.status || 'pending';
    if (st === 'active' || st === 'paused') { renderActive(st); return; }
    var map = {
      pending: ['Application sent', 'Pending review', 'is-warn', 'We read every application. You will get a notification when it has been reviewed.'],
      rejected: ['Application not approved', 'Not approved', 'is-bad', 'You can apply again after ' + T.reapplyDays + ' days.'],
      ended: ['Partnership ended', 'Ended', 'is-bad', 'Thank you for being a partner. You can re-apply after ' + T.reapplyDays + ' days.'],
      left: ['You left the programme', 'Left', '', 'You can re-apply after ' + T.reapplyDays + ' days.']
    };
    var m = map[st] || map.pending;
    $('pt-status-title').textContent = m[0]; badge($('pt-status-badge'), m[1], m[2]); badge(top, m[1], m[2]);
    $('pt-status-text').textContent = m[3];
    var reason = $('pt-status-reason');
    if (doc.reviewNote) { reason.hidden = false; reason.innerHTML = '<strong>Reason:</strong> ' + esc(doc.reviewNote); } else reason.hidden = true;
    var acts = $('pt-status-actions'); acts.innerHTML = '';
    if (st === 'pending') acts.innerHTML = '<button type="button" class="btn btn-secondary" id="pt-withdraw">Withdraw application</button>';
    else {
      var wait = (doc.reapplyAfterMillis || 0) - Date.now();
      if (wait > 0) acts.innerHTML = '<span class="pt-meta">You can re-apply on ' + esc(fmtDate(doc.reapplyAfterMillis)) + '.</span>';
      else acts.innerHTML = '<button type="button" class="btn btn-primary" id="pt-reapply">Apply again</button>';
    }
    show('pt-status', true);
  }

  function weekKeyNow() { return PT.isoWeekKey(Date.now()); }
  function renderActive(st) {
    var paused = st === 'paused', until = Number(doc.proUntil) || 0;
    badge($('pt-badge'), paused ? 'Paused' : 'Partner', paused ? 'is-warn' : 'is-ok');
    badge($('pt-active-badge'), paused ? 'Paused' : 'Active', paused ? 'is-warn' : 'is-ok');
    $('pt-active-title').textContent = paused ? 'Your partnership is paused' : 'Pro is active';
    var untilEl = $('pt-until');
    if (paused) untilEl.innerHTML = until > Date.now() ? 'Pro stays on until <strong>' + esc(fmtDate(until)) + '</strong>. Fix the points below and tell us, and we will renew it.' : 'Pro is not being renewed right now. Fix the points below and we will review it.';
    else untilEl.innerHTML = until ? 'Pro active until <strong>' + esc(fmtDate(until)) + '</strong>. It renews after the monthly check.' : 'Pro is active.';
    var r = $('pt-active-reason');
    if (doc.reviewNote) { r.hidden = false; r.innerHTML = '<strong>Note from TradeZoro:</strong> ' + esc(doc.reviewNote); } else r.hidden = true;

    var key = weekKeyNow(), links = (weeks[key] && weeks[key].links) || [], n = links.length, goal = T.postsPerWeek;
    $('pt-week-label').textContent = key.replace('-', ' ');
    $('pt-checklist').innerHTML =
      row(true, 'Bio line in place', 'Checked when you were approved. We re-check it every month.', 'Required') +
      row(n >= goal, 'Posts this week', 'Tag ' + T.handle + ' and label ' + T.tags.join(' or ') + '.', n + '/' + goal);
    var hist = $('pt-history'), miss = PT.missedWeeks(weeklyMap(), doc.approvedAtMillis, Date.now(), T.historyWeeks), keys = historyKeys();
    hist.innerHTML = keys.length ? keys.map(function (k) {
      var c = weeks[k] ? weeks[k].links.length : 0, ok = c >= goal;
      return row(ok, k.replace('-', ' '), weeks[k] ? weeks[k].links.slice(0, 3).map(function (u) { return '<a href="' + esc(u) + '" target="_blank" rel="noopener noreferrer">' + esc(u.replace(/^https:\/\//, '').slice(0, 48)) + '</a>'; }).join('<br>') : 'No links', c + '/' + goal, !ok && miss.indexOf(k) >= 0);
    }).join('') : '<li class="pt-row"><span class="pt-row-main pt-meta">Nothing yet. Your weeks will show here.</span></li>';
    show('pt-active', true);
    $('pt-terms-active').innerHTML = '<details class="panel pt-details"><summary class="pt-linkbtn">Partner terms</summary><div class="pt-sheet-body" style="margin-top:16px;max-height:none">' + termsHtml(true) + '</div></details>';
  }
  function row(done, title, sub, end, miss) {
    return '<li class="pt-row"><span class="pt-dot' + (done ? ' is-done' : miss ? ' is-miss' : '') + '">' + (done ? CHECK : '') + '</span><span class="pt-row-main">' + esc(title) + '<span class="pt-row-sub">' + (sub.indexOf('<a') >= 0 ? sub : esc(sub)) + '</span></span><span class="pt-row-end">' + esc(end) + '</span></li>';
  }
  function weeklyMap() { var o = {}; Object.keys(weeks).forEach(function (k) { o[k] = weeks[k].links; }); return o; }
  function historyKeys() {
    var cur = weekKeyNow();
    return Object.keys(weeks).filter(function (k) { return k !== cur; }).sort().reverse().slice(0, T.historyWeeks);
  }

  // ---- actions --------------------------------------------------------------------------------------
  function readForm() {
    var v = function (id) { return $(id).value.trim(); };
    var posts = [0, 1, 2].map(function (i) { return PT.cleanLink(v('pt-post-' + i)); });
    if (!v('pt-handle')) return { error: 'Add your handle.' };
    if (!PT.cleanLink(v('pt-profile'))) return { error: 'Add the link to your profile. It must start with https://' };
    var f = parseInt(v('pt-followers'), 10);
    if (!(f >= 0)) return { error: 'Add your follower count.' };
    if (f < T.minFollowers) return { error: 'You need at least ' + num(T.minFollowers) + ' followers to apply.' };
    if (posts.some(function (p) { return !p; })) return { error: 'Add three post links. Each must start with https://' };
    if (new Set(posts).size < 3) return { error: 'Add three different posts.' };
    if (!v('pt-why')) return { error: 'Tell us briefly why you want to be a partner.' };
    if (!$('pt-agree').checked) return { error: 'Please agree to the Partner terms.' };
    return { data: { platform: v('pt-platform'), handle: v('pt-handle').slice(0, 60), profileUrl: PT.cleanLink(v('pt-profile')), followers: f, postLinks: posts, why: v('pt-why').slice(0, 600), agreedAt: firebase.firestore.FieldValue.serverTimestamp() } };
  }
  function submitApplication(e) {
    e.preventDefault(); err('pt-form-error', '');
    var r = readForm(); if (r.error) { err('pt-form-error', r.error); return; }
    var btn = $('pt-submit'); btn.disabled = true; btn.textContent = 'Sending…';
    db.collection('partners').doc(uid).set(r.data).then(load).catch(function (x) {
      console.error('partner apply', x);
      err('pt-form-error', 'We could not send your application. Check the links and try again.');
    }).then(function () { btn.disabled = false; btn.textContent = 'Send application'; });
  }
  function addLinks(e) {
    e.preventDefault(); err('pt-links-error', '');
    var raw = $('pt-links').value.split(/\s+/).filter(Boolean), clean = raw.map(PT.cleanLink);
    if (!raw.length) { err('pt-links-error', 'Paste at least one link.'); return; }
    if (clean.some(function (x) { return !x; })) { err('pt-links-error', 'Every link must start with https://'); return; }
    var key = weekKeyNow(), cur = (weeks[key] && weeks[key].links) || [];
    var merged = cur.slice(); clean.forEach(function (u) { if (merged.indexOf(u) < 0) merged.push(u); });
    if (merged.length === cur.length) { err('pt-links-error', 'Those links are already added.'); return; }
    if (merged.length > T.maxLinksPerWeek) { err('pt-links-error', 'You can add up to ' + T.maxLinksPerWeek + ' links a week.'); return; }
    var btn = $('pt-links-btn'); btn.disabled = true;
    db.collection('partners').doc(uid).collection('weeks').doc(key).set({ links: merged, updatedAt: firebase.firestore.FieldValue.serverTimestamp() })
      .then(function () { $('pt-links').value = ''; if (window.showToast) showToast('success', 'Links added to ' + key.replace('-', ' ') + '.'); return load(); })
      .catch(function (x) { console.error('partner links', x); err('pt-links-error', 'We could not save the links. Try again.'); })
      .then(function () { btn.disabled = false; });
  }
  function leave() {
    if (!window.confirm('Leave the Partner programme? Pro stays on until the end of the month already given.')) return;
    firebase.app().functions().httpsCallable('partnerLeave')({}).then(load).catch(function (x) { console.error(x); err('pt-error', 'We could not process that. Try again in a moment.'); });
  }
  function reapply() {
    db.collection('partners').doc(uid).delete().then(function () { doc = null; weeks = {}; render(); }).catch(function (x) { console.error(x); err('pt-error', 'You cannot re-apply yet.'); });
  }

  // ---- terms sheet ----------------------------------------------------------------------------------
  function openTerms() { $('pt-terms-sheet').innerHTML = termsHtml(true); $('pt-terms-modal').hidden = false; var c = $('pt-terms-modal').querySelector('[data-close]'); if (c) c.focus(); }
  function closeTerms() { $('pt-terms-modal').hidden = true; }

  // ---- load -----------------------------------------------------------------------------------------
  function load() {
    err('pt-error', '');
    var ref = db.collection('partners').doc(uid);
    return ref.get().then(function (s) {
      doc = s.exists ? s.data() : null; weeks = {};
      if (!doc || (doc.status !== 'active' && doc.status !== 'paused')) return;
      return ref.collection('weeks').get().then(function (q) { q.forEach(function (d) { var x = d.data(); if (x && Array.isArray(x.links)) weeks[d.id] = x; }); });
    }).then(render).catch(function (x) { console.error('partner load', x); show('pt-loading', false); err('pt-error', 'We could not load your Partner page. Refresh to try again.'); });
  }

  document.addEventListener('DOMContentLoaded', function () {
    if (typeof auth === 'undefined' || !auth || typeof db === 'undefined' || !db) { show('pt-loading', false); err('pt-error', 'We could not load your Partner page. Refresh to try again.'); return; }
    $('pt-platform').innerHTML = T.platforms.map(function (p) { return '<option value="' + esc(p.id) + '">' + esc(p.name) + '</option>'; }).join('');
    $('pt-followers-help').textContent = 'At least ' + num(T.minFollowers) + '.';
    $('pt-form').addEventListener('submit', submitApplication);
    $('pt-links-form').addEventListener('submit', addLinks);
    $('pt-leave').addEventListener('click', leave);
    $('pt-open-terms').addEventListener('click', openTerms);
    $('pt-why').addEventListener('input', function () { $('pt-why-count').textContent = this.value.length; });
    $('pt-terms-modal').addEventListener('click', function (e) { if (e.target === this || e.target.closest('[data-close]')) closeTerms(); });
    document.addEventListener('click', function (e) {
      if (e.target.id === 'pt-reapply') reapply();
      if (e.target.id === 'pt-withdraw') leave();
    });
    var handled = false;
    auth.onAuthStateChanged(function (u) {
      if (handled) return;
      if (!u) { setTimeout(function () { if (!handled && typeof goToLoginPreservingReturn === 'function') goToLoginPreservingReturn(); }, 1500); return; }
      handled = true; uid = u.uid; load();
    });
  });
})();
