// TradeZoro — Suggestions board (suggestions.html)
// Depends on: firebase compat app/auth/firestore (+ storage, loaded on demand for screenshots), assets/auth.js (auth,
// goToLoginPreservingReturn), assets/progress.js (db), assets/toast.js (showToast). Styles: assets/suggestions.css.
//
// Data (rules: functions-src/firestore.rules, "Suggestions board" block; tests: tools/suggestions/rules-test.py):
//   suggestions/{id}            { title, body, category, imageUrl, authorUid, authorName, status, votes, voteRing,
//                                 commentsCount, createdAt, updatedAt, hidden, [officialReply {text, at, by}], [history [{s, at}]],
//                                 [statusAt], [mergedInto], [roadmapId], [shippedBuild] }
//   suggestions/{id}/votes/{uid}     { uid, at, day }  existence = vote; never listed for members (no voter names)
//   suggestions/{id}/comments/{cid}  { authorUid, authorName, text, createdAt, updatedAt }
//   suggestMeta/{uid}                rate limits + proof for comment counts (see rules)
//   suggestBans/{uid}                admin-written posting ban
// Every counter move is a batch the rules check: the vote marker and votes +1/-1 travel together, a comment and
// commentsCount +1/-1 travel together with the member's meta doc naming that comment.
// voteRing = { s<day%8>: { d: <UTC day>, n } }: votes per day for the last 8 days; Trending = votes in the last 7.
// Routing: /suggestions (list), /suggestions#<id> (detail, shareable).
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  if (!$('sg-list')) return;

  var CATS = [['charts', 'ZoroCharts'], ['indicators', 'Indicators'], ['gex', 'GEX+'], ['replay', 'Replay One'], ['journal', 'JournalX'],
    ['stats', 'Market Stats'], ['courses', 'Courses'], ['creator', 'Creator Hub'], ['mobile', 'Mobile'], ['other', 'Other']];
  var STATUS = [['new', 'New'], ['review', 'Under review'], ['planned', 'Planned'], ['progress', 'In progress'], ['shipped', 'Shipped'], ['declined', 'Not planned']];
  var STATUS_HELP = { new: 'Waiting for the team to read it.', review: 'The team is looking into it.', planned: 'On the list to build. Plans can change.',
    progress: 'Being built now.', shipped: 'Live on the site.', declined: 'Not something we plan to build.' };
  var catName = function (k) { var c = CATS.filter(function (x) { return x[0] === k; })[0]; return c ? c[1] : 'Other'; };
  var stName = function (k) { var c = STATUS.filter(function (x) { return x[0] === k; })[0]; return c ? c[1] : 'New'; };
  var MAX_TITLE = 80, MAX_BODY = 1000, MAX_COMMENT = 1000, DAY_MS = 86400000, MAX_IMG = 5 * 1024 * 1024;

  var all = [], me = null, isAdmin = false, myVotes = {}, meta = null, myName = 'Member', banned = false;
  var sort = 'top', q = '', fCat = '', fStatus = '', loaded = false, roadmapItems = null;

  // ---------- helpers ----------
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function toast(type, msg) { if (window.showToast) window.showToast(type, msg); }
  function ms(t) { return t && t.toMillis ? t.toMillis() : (t instanceof Date ? t.getTime() : (typeof t === 'number' ? t : 0)); }
  function today() { return Math.floor(Date.now() / DAY_MS); }
  function ago(t) {
    var m = ms(t); if (!m) return 'just now';
    var s = Math.max(0, (Date.now() - m) / 1000);
    if (s < 60) return 'just now'; if (s < 3600) return Math.floor(s / 60) + 'm ago'; if (s < 86400) return Math.floor(s / 3600) + 'h ago';
    if (s < 86400 * 30) return Math.floor(s / 86400) + 'd ago';
    return new Date(m).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }
  function trend(s) {
    var r = s.voteRing || {}, t = today(), n = 0;
    Object.keys(r).forEach(function (k) { var x = r[k] || {}; if (typeof x.d === 'number' && x.d > t - 7) n += x.n || 0; });
    return n;
  }
  var ST = function () { return firebase.firestore.FieldValue.serverTimestamp(); };
  var INC = function (n) { return firebase.firestore.FieldValue.increment(n); };
  var col = function () { return db.collection('suggestions'); };
  function needSignIn(why) {
    try { sessionStorage.setItem('stryker_return_to', location.pathname + location.search + location.hash); } catch (e) {}
    toast('info', why || 'Sign in to take part.');
    setTimeout(function () { location.href = '/login'; }, 600);
  }
  var svg = function (p, w) { return '<svg width="' + (w || 16) + '" height="' + (w || 16) + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + p + '</svg>'; };
  var IC = {
    up: '<path d="m6 14 6-6 6 6"/>', chat: '<path d="M21 12a8 8 0 0 1-8 8H4l2.5-3A8 8 0 1 1 21 12z"/>', back: '<path d="M15 18l-6-6 6-6"/>',
    link: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>', pin: '<path d="M12 2l2.4 6.5L21 9l-5 4.5L17.5 21 12 17l-5.5 4L8 13.5 3 9l6.6-.5z"/>', img: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 17-5-5-9 8"/>'
  };

  // ---------- fuzzy "similar suggestions" ----------
  var STOP = { the: 1, a: 1, an: 1, and: 1, or: 1, to: 1, of: 1, for: 1, in: 1, on: 1, with: 1, be: 1, is: 1, it: 1, me: 1, my: 1, i: 1, add: 1, please: 1, can: 1, we: 1, you: 1, at: 1, as: 1, should: 1, would: 1, like: 1, option: 1, feature: 1, support: 1 };
  function stem(w) { return w.length > 4 ? w.replace(/(ing|ed|es|s)$/, '') : w; }
  function toks(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9+ ]+/g, ' ').split(/\s+/).filter(function (w) { return w && !STOP[w] && w.length > 1; }).map(stem); }
  function similar(title, exceptId) {
    var a = toks(title); if (a.length < 1 || title.trim().length < 4) return [];
    var A = {}; a.forEach(function (w) { A[w] = 1; });
    return all.filter(function (s) { return !s.hidden && !s.mergedInto && s.id !== exceptId; }).map(function (s) {
      var b = toks(s.title), hit = 0, B = {};
      b.forEach(function (w) { B[w] = 1; });
      Object.keys(A).forEach(function (w) {
        if (B[w]) { hit += 1; return; }
        for (var k in B) { if (w.length >= 4 && k.length >= 4 && (k.indexOf(w) === 0 || w.indexOf(k) === 0)) { hit += 0.7; return; } }
      });
      var score = hit / Math.max(1, Math.min(Object.keys(A).length, Object.keys(B).length) + 0.5 * Math.abs(Object.keys(A).length - Object.keys(B).length));
      return { s: s, score: score };
    }).filter(function (x) { return x.score >= 0.45; }).sort(function (x, y) { return y.score - x.score || (y.s.votes || 0) - (x.s.votes || 0); }).slice(0, 3).map(function (x) { return x.s; });
  }

  // ---------- list ----------
  $('sg-cat').innerHTML = '<option value="">All categories</option>' + CATS.map(function (c) { return '<option value="' + c[0] + '">' + c[1] + '</option>'; }).join('');
  $('sg-status').innerHTML = '<option value="">Any status</option>' + STATUS.map(function (c) { return '<option value="' + c[0] + '">' + c[1] + '</option>'; }).join('') + '<option value="open">Open (not shipped)</option>';
  $('sg-cat').addEventListener('change', function () { fCat = this.value; renderList(); });
  $('sg-status').addEventListener('change', function () { fStatus = this.value; renderList(); });
  $('sg-q').addEventListener('input', function () { q = this.value.trim(); renderList(); });
  $('sg-sort').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return; sort = b.dataset.s;
    this.querySelectorAll('button').forEach(function (x) { var on = x === b; x.classList.toggle('on', on); x.setAttribute('aria-selected', on ? 'true' : 'false'); });
    renderList();
  });
  $('sg-new-btn').addEventListener('click', function () { openForm(''); });

  function voteBtn(s, big) {
    var on = !!myVotes[s.id];
    return '<button type="button" class="sg-vote' + (on ? ' on' : '') + (big ? ' big' : '') + '" data-vote="' + esc(s.id) + '" aria-pressed="' + on + '" aria-label="' + (on ? 'Remove your vote' : 'Vote for this') + ' (' + (s.votes || 0) + ' votes)">' +
      svg(IC.up, big ? 20 : 18) + '<b>' + (s.votes || 0) + '</b></button>';
  }
  function pill(st) { return '<span class="sg-pill is-' + esc(st || 'new') + '">' + esc(stName(st)) + '</span>'; }
  function card(s) {
    var body = String(s.body || ''); if (body.length > 160) body = body.slice(0, 157).replace(/\s+\S*$/, '') + '…';
    return '<article class="sg-card' + (s.hidden ? ' is-hidden' : '') + '" data-id="' + esc(s.id) + '">' + voteBtn(s) +
      '<a class="sg-card-main" href="#' + esc(s.id) + '">' +
      '<div class="sg-card-top">' + pill(s.status) + '<span class="sg-chip">' + esc(catName(s.category)) + '</span>' + (s.hidden ? '<span class="sg-chip is-warn">Hidden</span>' : '') + '</div>' +
      '<h3>' + esc(s.title) + '</h3>' + (body ? '<p>' + esc(body) + '</p>' : '') +
      '<div class="sg-card-meta"><span class="sg-cm">' + svg(IC.chat, 14) + (s.commentsCount || 0) + '</span>' +
      (s.status === 'shipped' && s.shippedBuild ? '<span class="sg-ship">Shipped in build ' + esc(s.shippedBuild) + '</span>' : '') +
      (s.officialReply && s.officialReply.text ? '<span class="sg-replied">Team replied</span>' : '') +
      '<span>' + esc(s.authorName || 'Member') + ' · ' + ago(s.createdAt) + '</span></div></a></article>';
  }
  function filtered() {
    var qt = toks(q), ql = q.toLowerCase();
    var list = all.filter(function (s) {
      if (s.mergedInto && !isAdmin) return false;
      if (fCat && s.category !== fCat) return false;
      if (fStatus === 'open' ? (s.status === 'shipped' || s.status === 'declined') : (fStatus && s.status !== fStatus)) return false;
      if (ql) {
        var hay = (s.title + ' ' + (s.body || '')).toLowerCase();
        if (hay.indexOf(ql) >= 0) return true;
        var ht = toks(hay); return qt.length && qt.every(function (w) { return ht.some(function (h) { return h.indexOf(w) === 0 || w.indexOf(h) === 0 && h.length >= 4; }); });
      }
      return true;
    });
    var by = sort === 'new' ? function (a, b) { return ms(b.createdAt) - ms(a.createdAt); }
      : sort === 'trending' ? function (a, b) { return trend(b) - trend(a) || (b.votes || 0) - (a.votes || 0) || ms(b.createdAt) - ms(a.createdAt); }
        : function (a, b) { return (b.votes || 0) - (a.votes || 0) || ms(b.createdAt) - ms(a.createdAt); };
    return list.sort(by);
  }
  function renderList() {
    if (!loaded) return;
    var list = filtered();
    $('sg-list').innerHTML = list.map(card).join('');
    $('sg-count').textContent = list.length + (list.length === 1 ? ' suggestion' : ' suggestions') + (q ? ' match "' + q + '"' : '');
    var e = $('sg-empty'); e.hidden = list.length > 0;
    if (!list.length) {
      e.innerHTML = all.length ? (q ? 'Nothing matches "' + esc(q) + '". <button type="button" class="sg-linkbtn" data-new-from-q>Suggest it</button>' : 'No suggestions match these filters.')
        : 'No suggestions yet. <button type="button" class="sg-linkbtn" data-new-from-q>Be the first</button>';
    }
  }
  document.addEventListener('click', function (e) {
    var v = e.target.closest('[data-vote]'); if (v) { e.preventDefault(); toggleVote(v.dataset.vote); return; }
    if (e.target.closest('[data-new-from-q]')) { openForm(q); return; }
  });

  // ---------- votes ----------
  var voting = {};
  function toggleVote(id) {
    if (!me) { needSignIn('Sign in to vote. Free and Pro members can vote.'); return; }
    var s = all.filter(function (x) { return x.id === id; })[0] || (current && current.id === id ? current : null);
    if (!s || voting[id]) return;
    if (s.hidden && !myVotes[id]) { toast('info', 'This suggestion is hidden.'); return; }
    voting[id] = true;
    var ref = col().doc(id), vref = ref.collection('votes').doc(me.uid), b = db.batch(), had = myVotes[id], t = today();
    var ring = s.voteRing || {}, upd = {};
    if (!had) {
      var k = 's' + (t % 8), o = ring[k] || {};
      upd.votes = INC(1); upd['voteRing.' + k] = { d: t, n: o.d === t ? (o.n || 0) + 1 : 1 };
      b.set(vref, { uid: me.uid, at: ST(), day: t }); b.update(ref, upd);
    } else {
      var vd = had.day, k2 = 's' + (vd % 8), o2 = ring[k2] || {};
      upd.votes = INC(-1);
      if (typeof vd === 'number' && o2.d === vd && (o2.n || 0) > 0) upd['voteRing.' + k2] = { d: vd, n: o2.n - 1 };
      b.delete(vref); b.update(ref, upd);
    }
    // optimistic
    applyVote(s, !had, t);
    b.commit().then(function () { voting[id] = false; }).catch(function (err) {
      voting[id] = false; applyVote(s, !!had, had ? had.day : t, true);
      console.warn('TradeZoro: vote failed', err); toast('error', 'Could not save your vote. Refresh and try again.');
    });
  }
  function applyVote(s, on, day, revert) {
    var t = today(), k = 's' + ((on ? day : (myVotes[s.id] || {}).day || t) % 8);
    s.voteRing = Object.assign({}, s.voteRing || {});
    if (on && !myVotes[s.id]) { s.votes = (s.votes || 0) + 1; myVotes[s.id] = { day: day }; var o = s.voteRing[k] || {}; s.voteRing[k] = { d: day, n: o.d === day ? (o.n || 0) + 1 : 1 }; }
    else if (!on && myVotes[s.id]) { s.votes = Math.max(0, (s.votes || 0) - 1); var o2 = s.voteRing[k] || {}; if (o2.d === myVotes[s.id].day && o2.n > 0) s.voteRing[k] = { d: o2.d, n: o2.n - 1 }; delete myVotes[s.id]; }
    document.querySelectorAll('[data-vote="' + (window.CSS && CSS.escape ? CSS.escape(s.id) : s.id) + '"]').forEach(function (btn) {
      var big = btn.classList.contains('big'); var tmp = document.createElement('div'); tmp.innerHTML = voteBtn(s, big); btn.replaceWith(tmp.firstChild);
    });
    var vc = $('sg-d-votes'); if (vc) vc.textContent = votersText(s);
    if (!revert && on) { var nb = document.querySelector('[data-vote="' + s.id + '"]'); if (nb) { nb.classList.add('pop'); setTimeout(function () { nb.classList.remove('pop'); }, 400); } }
  }
  function loadMyVotes(ids) {
    if (!me) return Promise.resolve();
    return Promise.all(ids.map(function (id) {
      return col().doc(id).collection('votes').doc(me.uid).get().then(function (d) { if (d.exists) myVotes[id] = { day: d.data().day }; }).catch(function () {});
    }));
  }
  var votersText = function (s) { var n = s.votes || 0; return n + (n === 1 ? ' member wants this' : ' members want this'); };

  // ---------- new suggestion sheet ----------
  var sheet = $('sg-sheet'), scrim = $('sg-scrim'), lastFocus = null, pickedFile = null;
  function openSheet(html) {
    lastFocus = document.activeElement; sheet.innerHTML = html; sheet.hidden = false; scrim.hidden = false;
    document.documentElement.classList.add('sg-lock');
    requestAnimationFrame(function () { sheet.classList.add('open'); scrim.classList.add('open'); var f = sheet.querySelector('input,textarea,select,button'); if (f) f.focus(); });
  }
  function closeSheet() {
    sheet.classList.remove('open'); scrim.classList.remove('open'); document.documentElement.classList.remove('sg-lock');
    setTimeout(function () { sheet.hidden = true; scrim.hidden = true; sheet.innerHTML = ''; }, 220);
    pickedFile = null; if (lastFocus && lastFocus.focus) lastFocus.focus();
  }
  scrim.addEventListener('click', closeSheet);
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { if (!$('sg-zoom').hidden) { closeZoom(); return; } if (!sheet.hidden) closeSheet(); }
  });
  function postsLeft() { return !meta || meta.sDay !== today() ? 5 : Math.max(0, 5 - (meta.sN || 0)); }
  function openForm(prefill) {
    if (!me) { needSignIn('Sign in to suggest a feature. Free and Pro members can post.'); return; }
    if (banned) { toast('error', 'Your account cannot post suggestions. Contact support if you think this is a mistake.'); return; }
    if (!postsLeft()) { toast('info', 'You have posted 5 suggestions today. You can post again tomorrow (UTC).'); return; }
    openSheet('<div class="sg-sh-grip" aria-hidden="true"></div><div class="sg-sh-head"><h2 id="sg-sheet-title">Suggest a feature</h2><button type="button" class="sg-icon-btn" data-close aria-label="Close">' + svg(IC.x, 18) + '</button></div>' +
      '<form class="sg-form" id="sg-form" novalidate>' +
      '<label class="sg-field"><span>Title</span><input id="sg-f-title" maxlength="' + MAX_TITLE + '" required placeholder="One line: what should we add?" autocomplete="off" value="' + esc(prefill || '') + '"><small class="sg-cnt" id="sg-f-tc">0/' + MAX_TITLE + '</small></label>' +
      '<div class="sg-similar" id="sg-similar" hidden></div>' +
      '<label class="sg-field"><span>Category</span><select id="sg-f-cat" required><option value="">Choose one</option>' + CATS.map(function (c) { return '<option value="' + c[0] + '">' + c[1] + '</option>'; }).join('') + '</select></label>' +
      '<label class="sg-field"><span>Details <em>(optional)</em></span><textarea id="sg-f-body" rows="5" maxlength="' + MAX_BODY + '" placeholder="What problem would it solve? How would you use it?"></textarea><small class="sg-cnt" id="sg-f-bc">0/' + MAX_BODY + '</small></label>' +
      '<div class="sg-field"><span>Screenshot <em>(optional, image up to 5 MB)</em></span><label class="sg-file"><input type="file" id="sg-f-img" accept="image/png,image/jpeg,image/webp,image/gif">' + svg(IC.img, 18) + '<span id="sg-f-imgname">Add an image</span></label></div>' +
      '<p class="sg-form-note">Posting as <b>' + esc(myName) + '</b>. Your vote is added automatically. ' + postsLeft() + ' of 5 posts left today. Do not include personal details.</p>' +
      '<p class="sg-err" id="sg-f-err" role="alert" hidden></p>' +
      '<div class="sg-form-actions"><button type="button" class="sg-btn sg-btn-ghost" data-close>Cancel</button><button type="submit" class="sg-btn sg-btn-primary" id="sg-f-submit">Post suggestion</button></div></form>');
    var ti = $('sg-f-title'), bo = $('sg-f-body');
    var upd = function () { $('sg-f-tc').textContent = ti.value.length + '/' + MAX_TITLE; $('sg-f-bc').textContent = bo.value.length + '/' + MAX_BODY; showSimilar(ti.value); };
    ti.addEventListener('input', upd); bo.addEventListener('input', upd); upd();
    $('sg-f-img').addEventListener('change', function () {
      var f = this.files && this.files[0]; pickedFile = null;
      if (!f) { $('sg-f-imgname').textContent = 'Add an image'; return; }
      if (!/^image\/(png|jpeg|webp|gif)$/.test(f.type)) { this.value = ''; $('sg-f-imgname').textContent = 'Add an image'; toast('error', 'Use a PNG, JPEG, WebP or GIF image.'); return; }
      if (f.size >= MAX_IMG) { this.value = ''; $('sg-f-imgname').textContent = 'Add an image'; toast('error', 'That image is over 5 MB.'); return; }
      pickedFile = f; $('sg-f-imgname').textContent = f.name.length > 34 ? f.name.slice(0, 31) + '…' : f.name;
    });
    $('sg-form').addEventListener('submit', function (e) { e.preventDefault(); submitForm(); });
  }
  sheet.addEventListener('click', function (e) {
    if (e.target.closest('[data-close]')) { closeSheet(); return; }
    var vi = e.target.closest('[data-vote-instead]');
    if (vi) { var id = vi.dataset.voteInstead; closeSheet(); if (!myVotes[id]) toggleVote(id); else toast('info', 'You already voted for this one.'); location.hash = id; }
  });
  function showSimilar(title) {
    var box = $('sg-similar'); if (!box) return;
    var list = similar(title);
    box.hidden = !list.length;
    box.innerHTML = list.length ? '<p class="sg-sim-h">Similar suggestions</p>' + list.map(function (s) {
      return '<div class="sg-sim"><div><b>' + esc(s.title) + '</b><span>' + pill(s.status) + ' ' + (s.votes || 0) + ((s.votes || 0) === 1 ? ' vote' : ' votes') + '</span></div>' +
        '<button type="button" class="sg-btn sg-btn-soft" data-vote-instead="' + esc(s.id) + '">' + (myVotes[s.id] ? 'Open' : 'Vote for this instead') + '</button></div>';
    }).join('') : '';
  }
  function loadStorage() {
    if (firebase.storage) return Promise.resolve();
    return new Promise(function (res, rej) {
      var sc = document.createElement('script'); sc.src = 'https://www.gstatic.com/firebasejs/10.14.1/firebase-storage-compat.js';
      sc.onload = function () { res(); }; sc.onerror = function () { rej(new Error('storage sdk')); }; document.head.appendChild(sc);
    });
  }
  function uploadImage(sid, file) {
    return loadStorage().then(function () {
      var ext = ({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' })[file.type] || 'png';
      var ref = firebase.storage().ref('suggestions/' + me.uid + '/' + sid + '.' + ext);
      return ref.put(file, { contentType: file.type, cacheControl: 'public, max-age=31536000' }).then(function () { return ref.getDownloadURL(); });
    });
  }
  function submitForm() {
    var title = $('sg-f-title').value.replace(/\s+/g, ' ').trim(), body = $('sg-f-body').value.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim(), cat = $('sg-f-cat').value;
    var err = $('sg-f-err'), btn = $('sg-f-submit');
    var fail = function (m) { err.textContent = m; err.hidden = false; btn.disabled = false; btn.textContent = 'Post suggestion'; };
    if (title.length < 4) return fail('Give it a title of at least 4 characters.');
    if (title.length > MAX_TITLE) return fail('Keep the title under ' + MAX_TITLE + ' characters.');
    if (body.length > MAX_BODY) return fail('Keep the details under ' + MAX_BODY + ' characters.');
    if (!cat) return fail('Choose a category.');
    if (!postsLeft()) return fail('You have posted 5 suggestions today. You can post again tomorrow (UTC).');
    err.hidden = true; btn.disabled = true; btn.textContent = pickedFile ? 'Uploading…' : 'Posting…';
    var ref = col().doc(), t = today(), k = 's' + (t % 8);
    var img = pickedFile ? uploadImage(ref.id, pickedFile) : Promise.resolve('');
    img.catch(function (e) { console.warn('TradeZoro: upload failed', e); throw new Error('upload'); }).then(function (url) {
      btn.textContent = 'Posting…';
      var doc = { title: title, body: body, category: cat, imageUrl: url || '', authorUid: me.uid, authorName: myName, status: 'new', votes: 1,
        voteRing: {}, commentsCount: 0, createdAt: ST(), updatedAt: ST(), hidden: false };
      doc.voteRing[k] = { d: t, n: 1 };
      var newMeta = { sDay: t, sN: meta && meta.sDay === t ? (meta.sN || 0) + 1 : 1, sSid: ref.id, sAt: ST() };
      var b = db.batch();
      b.set(ref, doc);
      b.set(ref.collection('votes').doc(me.uid), { uid: me.uid, at: ST(), day: t });
      b.set(db.collection('suggestMeta').doc(me.uid), newMeta, { merge: true });
      return b.commit().then(function () {
        meta = Object.assign({}, meta || {}, newMeta);
        var local = Object.assign({}, doc, { id: ref.id, createdAt: new Date(), updatedAt: new Date() });
        all.unshift(local); myVotes[ref.id] = { day: t };
        closeSheet(); renderList(); toast('success', 'Posted. Thanks for the idea.'); location.hash = ref.id;
      });
    }).catch(function (e) {
      if (e && e.message === 'upload') return fail('The image did not upload. Try a smaller image or post without it.');
      console.warn('TradeZoro: post failed', e);
      fail(e && e.code === 'permission-denied' ? 'Could not post. You may have reached today\'s limit of 5, or your account cannot post.' : 'Could not post. Check your connection and try again.');
    });
  }

  // ---------- detail ----------
  var current = null, comments = [], unsubC = null;
  function showList() {
    $('sg-detail-view').hidden = true; $('sg-list-view').hidden = false; current = null;
    if (unsubC) { unsubC(); unsubC = null; }
    document.title = 'Suggestions — TradeZoro';
    renderList();
  }
  function route() {
    var id = decodeURIComponent((location.hash || '').slice(1));
    if (!id || !/^[A-Za-z0-9_-]{6,40}$/.test(id)) { showList(); return; }
    openDetail(id);
  }
  window.addEventListener('hashchange', route);
  function openDetail(id) {
    $('sg-list-view').hidden = true; var v = $('sg-detail-view'); v.hidden = false;
    v.innerHTML = '<div class="sg-skel big"></div>';
    window.scrollTo(0, 0);
    var have = all.filter(function (x) { return x.id === id; })[0];
    var p = have ? Promise.resolve(have) : col().doc(id).get().then(function (d) { return d.exists ? Object.assign({ id: d.id }, d.data()) : null; });
    p.then(function (s) {
      if (!s) { v.innerHTML = '<a class="sg-back" href="#">' + svg(IC.back) + 'All suggestions</a><div class="sg-empty">This suggestion was not found. It may have been removed.</div>'; return; }
      if (s.mergedInto && !isAdmin) { location.replace('#' + s.mergedInto); return; }
      current = s;
      var mv = me && myVotes[id] === undefined ? loadMyVotes([id]) : Promise.resolve();
      mv.then(function () { renderDetail(); });
      if (unsubC) unsubC();
      unsubC = col().doc(id).collection('comments').orderBy('createdAt', 'desc').limit(200).onSnapshot(function (snap) {
        comments = snap.docs.map(function (d) { return Object.assign({ id: d.id }, d.data()); }); renderComments();
      }, function () { comments = []; renderComments(); });
    }).catch(function (e) { v.innerHTML = '<a class="sg-back" href="#">' + svg(IC.back) + 'All suggestions</a><div class="sg-empty">' + (e && e.code === 'permission-denied' ? 'This suggestion was not found. It may have been removed.' : 'Could not load this suggestion. Check your connection and try again.') + '</div>'; });
  }
  function renderDetail() {
    var s = current, v = $('sg-detail-view'); if (!s) return;
    document.title = s.title + ' — Suggestions — TradeZoro';
    var hist = (s.history || []).slice().sort(function (a, b) { return ms(b.at) - ms(a.at); });
    var rm = s.roadmapId ? '<a class="sg-chip is-link" href="/roadmap#rm-' + esc(s.roadmapId) + '">On the roadmap →</a>' : '';
    v.innerHTML = '<a class="sg-back" href="#">' + svg(IC.back) + 'All suggestions</a>' +
      '<article class="sg-detail">' +
      '<div class="sg-d-head">' + voteBtn(s, true) + '<div class="sg-d-titles"><div class="sg-card-top">' + pill(s.status) + '<span class="sg-chip">' + esc(catName(s.category)) + '</span>' + rm +
      (s.hidden ? '<span class="sg-chip is-warn">Hidden</span>' : '') + (s.mergedInto ? '<span class="sg-chip is-warn">Merged</span>' : '') + '</div>' +
      '<h1>' + esc(s.title) + '</h1><p class="sg-d-by">' + esc(s.authorName || 'Member') + ' · ' + ago(s.createdAt) + '</p></div></div>' +
      (s.status === 'shipped' && s.shippedBuild ? '<p class="sg-ship-banner">Shipped in build ' + esc(s.shippedBuild) + '</p>' : '') +
      (s.officialReply && s.officialReply.text ? '<div class="sg-official"><div class="sg-official-h">' + svg(IC.pin, 14) + 'Official reply <span>' + esc(s.officialReply.by || 'TradeZoro team') + ' · ' + ago(s.officialReply.at) + '</span></div><p>' + esc(s.officialReply.text) + '</p></div>' : '') +
      (s.body ? '<p class="sg-d-body">' + esc(s.body) + '</p>' : '') +
      (s.imageUrl ? '<button type="button" class="sg-d-img" data-zoom="' + esc(s.imageUrl) + '" aria-label="Open the screenshot full size"><img src="' + esc(s.imageUrl) + '" alt="Screenshot added to this suggestion" loading="lazy"></button>' : '') +
      '<div class="sg-d-bar"><span id="sg-d-votes">' + votersText(s) + '</span><span id="sg-d-ccount">' + (s.commentsCount || 0) + ((s.commentsCount || 0) === 1 ? ' comment' : ' comments') + '</span><button type="button" class="sg-btn sg-btn-soft" id="sg-share">' + svg(IC.link, 15) + 'Copy link</button></div>' +
      '<p class="sg-status-help">' + pill(s.status) + ' ' + esc(STATUS_HELP[s.status] || '') + '</p>' +
      (hist.length ? '<details class="sg-hist"><summary>Status history</summary><ol>' + hist.map(function (h) { return '<li>' + pill(h.s) + '<span>' + ago(h.at) + '</span></li>'; }).join('') + '</ol></details>' : '') +
      (isAdmin ? adminPanel(s) : '') +
      '</article>' +
      '<section class="sg-comments"><h2>Comments</h2>' +
      (me ? (banned ? '<p class="sg-muted">Your account cannot comment.</p>' :
        '<form class="sg-cform" id="sg-cform"><textarea id="sg-c-text" rows="2" maxlength="' + MAX_COMMENT + '" placeholder="Add a comment"></textarea><div class="sg-cform-row"><small class="sg-cnt" id="sg-c-cnt">0/' + MAX_COMMENT + '</small><button type="submit" class="sg-btn sg-btn-primary" id="sg-c-send">Comment</button></div></form>')
        : '<p class="sg-muted"><button type="button" class="sg-linkbtn" id="sg-c-signin">Sign in</button> to comment. Free and Pro members can comment.</p>') +
      '<div id="sg-c-list" class="sg-c-list"></div></section>';
    var sh = $('sg-share'); if (sh) sh.addEventListener('click', share);
    var si = $('sg-c-signin'); if (si) si.addEventListener('click', function () { needSignIn('Sign in to comment.'); });
    var cf = $('sg-cform');
    if (cf) {
      var ta = $('sg-c-text'); ta.addEventListener('input', function () { $('sg-c-cnt').textContent = ta.value.length + '/' + MAX_COMMENT; });
      cf.addEventListener('submit', function (e) { e.preventDefault(); postComment(); });
    }
    if (isAdmin) wireAdmin(s);
    renderComments();
  }
  function share() {
    var url = location.origin + '/suggestions#' + current.id;
    var done = function () { toast('success', 'Link copied.'); };
    if (navigator.share && /Mobi|Android|iPhone/i.test(navigator.userAgent)) { navigator.share({ title: current.title, url: url }).catch(function () {}); return; }
    if (navigator.clipboard) navigator.clipboard.writeText(url).then(done, function () { prompt('Copy this link', url); }); else prompt('Copy this link', url);
  }
  function canEdit(c) { return me && c.authorUid === me.uid && Date.now() - ms(c.createdAt) < 15 * 60000 - 5000; }
  function renderComments() {
    var box = $('sg-c-list'); if (!box) return;
    var cc = $('sg-d-ccount'); if (cc && current) { current.commentsCount = comments.length; cc.textContent = comments.length + (comments.length === 1 ? ' comment' : ' comments'); }
    box.innerHTML = comments.length ? comments.map(function (c) {
      var mine = canEdit(c), edited = ms(c.updatedAt) - ms(c.createdAt) > 2000;
      return '<div class="sg-c" data-cid="' + esc(c.id) + '"><div class="sg-c-h"><b>' + esc(c.authorName || 'Member') + '</b><span>' + ago(c.createdAt) + (edited ? ' · edited' : '') + '</span>' +
        (mine ? '<span class="sg-c-act"><button type="button" class="sg-linkbtn" data-cedit>Edit</button><button type="button" class="sg-linkbtn" data-cdel>Delete</button></span>' :
          (isAdmin ? '<span class="sg-c-act"><button type="button" class="sg-linkbtn" data-cdel>Delete</button></span>' : '')) +
        '</div><p>' + esc(c.text) + '</p></div>';
    }).join('') : '<p class="sg-muted">No comments yet.</p>';
  }
  function cooldownLeft() { if (!meta || !meta.cAt) return 0; return Math.max(0, Math.ceil((ms(meta.cAt) + 20500 - Date.now()) / 1000)); }
  function postComment() {
    var ta = $('sg-c-text'), btn = $('sg-c-send'), text = ta.value.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    if (!text) { ta.focus(); return; }
    if (text.length > MAX_COMMENT) { toast('error', 'Keep comments under ' + MAX_COMMENT + ' characters.'); return; }
    var wait = cooldownLeft(); if (wait) { toast('info', 'One comment every 20 seconds. Try again in ' + wait + ' s.'); return; }
    var s = current, ref = col().doc(s.id), cref = ref.collection('comments').doc(), b = db.batch();
    btn.disabled = true;
    b.set(cref, { authorUid: me.uid, authorName: myName, text: text, createdAt: ST(), updatedAt: ST() });
    b.update(ref, { commentsCount: INC(1) });
    b.set(db.collection('suggestMeta').doc(me.uid), { cSid: s.id, cCid: cref.id, cAt: ST() }, { merge: true });
    b.commit().then(function () {
      meta = Object.assign({}, meta || {}, { cSid: s.id, cCid: cref.id, cAt: Date.now() });
      ta.value = ''; $('sg-c-cnt').textContent = '0/' + MAX_COMMENT; btn.disabled = false;
      s.commentsCount = (s.commentsCount || 0) + 1; toast('success', 'Comment posted.');
    }).catch(function (e) {
      btn.disabled = false; console.warn('TradeZoro: comment failed', e);
      toast('error', e && e.code === 'permission-denied' ? 'Could not post. One comment every 20 seconds; wait a moment and try again.' : 'Could not post the comment. Try again.');
    });
  }
  document.addEventListener('click', function (e) {
    var z = e.target.closest('[data-zoom]'); if (z) { openZoom(z.dataset.zoom); return; }
    var ce = e.target.closest('[data-cedit]'), cd = e.target.closest('[data-cdel]');
    if (!ce && !cd) return;
    var cid = e.target.closest('[data-cid]').dataset.cid, c = comments.filter(function (x) { return x.id === cid; })[0]; if (!c || !current) return;
    var cref = col().doc(current.id).collection('comments').doc(cid);
    if (ce) {
      var el = e.target.closest('.sg-c');
      el.innerHTML = '<form class="sg-cform"><textarea rows="3" maxlength="' + MAX_COMMENT + '">' + esc(c.text) + '</textarea><div class="sg-cform-row"><button type="button" class="sg-btn sg-btn-ghost" data-ccancel>Cancel</button><button type="submit" class="sg-btn sg-btn-primary">Save</button></div></form>';
      var f = el.querySelector('form'), ta = f.querySelector('textarea'); ta.focus();
      f.querySelector('[data-ccancel]').addEventListener('click', renderComments);
      f.addEventListener('submit', function (ev) {
        ev.preventDefault(); var tx = ta.value.trim(); if (!tx) return;
        cref.update({ text: tx, updatedAt: ST() }).then(function () { toast('success', 'Saved.'); }).catch(function () { toast('error', 'Comments can only be edited for 15 minutes.'); renderComments(); });
      });
      return;
    }
    if (!confirm('Delete this comment?')) return;
    var b = db.batch(), sref = col().doc(current.id);
    b.delete(cref); b.update(sref, { commentsCount: INC(-1) });
    if (!isAdmin || c.authorUid === me.uid) b.set(db.collection('suggestMeta').doc(me.uid), { dSid: current.id, dCid: cid, dAt: ST() }, { merge: true });
    b.commit().then(function () { current.commentsCount = Math.max(0, (current.commentsCount || 0) - 1); toast('success', 'Comment deleted.'); })
      .catch(function () { toast('error', 'Comments can only be deleted for 15 minutes.'); });
  });
  function openZoom(src) { var z = $('sg-zoom'); z.querySelector('img').src = src; z.hidden = false; requestAnimationFrame(function () { z.classList.add('open'); }); }
  function closeZoom() { var z = $('sg-zoom'); z.classList.remove('open'); setTimeout(function () { z.hidden = true; }, 180); }
  $('sg-zoom').addEventListener('click', closeZoom);

  // ---------- admin ----------
  function adminPanel(s) {
    return '<details class="sg-admin" open><summary>Team tools</summary>' +
      '<div class="sg-admin-grid">' +
      '<label class="sg-field"><span>Status</span><select id="sg-a-status">' + STATUS.map(function (x) { return '<option value="' + x[0] + '"' + (x[0] === s.status ? ' selected' : '') + '>' + x[1] + '</option>'; }).join('') + '</select></label>' +
      '<label class="sg-field"><span>Shipped in build</span><input id="sg-a-build" inputmode="numeric" placeholder="e.g. 740" value="' + esc(s.shippedBuild || '') + '"></label>' +
      '<label class="sg-field"><span>Roadmap item</span><select id="sg-a-roadmap"><option value="">Not linked</option></select></label>' +
      '<label class="sg-field sg-span2"><span>Official reply (shown pinned, notifies the author and voters)</span><textarea id="sg-a-reply" rows="3" maxlength="1000">' + esc(s.officialReply && s.officialReply.text || '') + '</textarea></label>' +
      '<label class="sg-check sg-span2"><input type="checkbox" id="sg-a-notify" checked> Notify the author and voters about a status change or new reply</label>' +
      '</div><div class="sg-form-actions"><button type="button" class="sg-btn sg-btn-primary" id="sg-a-save">Save</button></div>' +
      '<div class="sg-admin-row"><label class="sg-field"><span>Merge into (keeps the older one)</span><select id="sg-a-merge"><option value="">Choose a suggestion</option>' +
      all.filter(function (x) { return x.id !== s.id && !x.mergedInto; }).sort(function (a, b) { return a.title.localeCompare(b.title); }).map(function (x) { return '<option value="' + esc(x.id) + '">' + esc(x.title.slice(0, 70)) + ' (' + (x.votes || 0) + ')</option>'; }).join('') + '</select></label>' +
      '<button type="button" class="sg-btn sg-btn-soft" id="sg-a-mergebtn">Merge</button></div>' +
      '<div class="sg-form-actions sg-admin-danger"><button type="button" class="sg-btn sg-btn-soft" id="sg-a-hide">' + (s.hidden ? 'Unhide' : 'Hide (spam)') + '</button>' +
      '<button type="button" class="sg-btn sg-btn-soft" id="sg-a-ban">Ban author from posting</button>' +
      '<button type="button" class="sg-btn sg-btn-danger" id="sg-a-del">Delete</button></div></details>';
  }
  function loadRoadmap() {
    if (roadmapItems) return Promise.resolve(roadmapItems);
    if (!window.StrykerRoadmap) return Promise.resolve([]);
    return window.StrykerRoadmap.load({ raw: true }).then(function (d) { roadmapItems = (d.items || []).filter(function (i) { return i && i.id && !i.auto; }); return roadmapItems; }).catch(function () { return []; });
  }
  function voterUids(id) {
    return col().doc(id).collection('votes').get().then(function (snap) { return snap.docs.map(function (d) { return d.id; }); }).catch(function () { return []; });
  }
  function notifyAll(s, message) {
    return voterUids(s.id).then(function (uids) {
      var set = {}; uids.concat([s.authorUid]).forEach(function (u) { if (u && u !== me.uid) set[u] = 1; });
      var list = Object.keys(set), chunks = [];
      for (var i = 0; i < list.length; i += 400) chunks.push(list.slice(i, i + 400));
      return Promise.all(chunks.map(function (ch) {
        var b = db.batch();
        ch.forEach(function (u) { b.set(db.collection('notifications').doc(), { recipientUid: u, type: 'suggestion', message: message.slice(0, 480), link: '/suggestions#' + s.id, read: false, senderUid: me.uid, createdAt: ST() }); });
        return b.commit();
      })).then(function () { return list.length; });
    });
  }
  function wireAdmin(s) {
    loadRoadmap().then(function (items) {
      var sel = $('sg-a-roadmap'); if (!sel) return;
      sel.innerHTML = '<option value="">Not linked</option>' + items.map(function (i) { return '<option value="' + esc(i.id) + '"' + (i.id === s.roadmapId ? ' selected' : '') + '>' + esc(i.title) + ' (' + esc(i.status) + ')</option>'; }).join('');
    });
    $('sg-a-save').addEventListener('click', function () {
      var st = $('sg-a-status').value, reply = $('sg-a-reply').value.trim(), build = $('sg-a-build').value.trim(), rmId = $('sg-a-roadmap').value;
      if (build && !/^\d{1,6}$/.test(build)) { toast('error', 'Build must be a number.'); return; }
      var upd = { updatedAt: ST() }, statusChanged = st !== s.status, oldReply = s.officialReply && s.officialReply.text || '', replyChanged = reply !== oldReply;
      if (statusChanged) { upd.status = st; upd.statusAt = ST(); upd.history = firebase.firestore.FieldValue.arrayUnion({ s: st, at: firebase.firestore.Timestamp.now() }); }
      if (replyChanged) upd.officialReply = reply ? { text: reply, at: ST(), by: 'TradeZoro team' } : firebase.firestore.FieldValue.delete();
      upd.shippedBuild = build ? Number(build) : firebase.firestore.FieldValue.delete();
      upd.roadmapId = rmId || firebase.firestore.FieldValue.delete();
      var btn = this; btn.disabled = true;
      col().doc(s.id).update(upd).then(function () { return col().doc(s.id).get(); }).then(function (d) {
        var fresh = Object.assign({ id: d.id }, d.data()); Object.keys(current).forEach(function (k) { delete current[k]; }); Object.assign(current, fresh);
        var i = all.findIndex(function (x) { return x.id === s.id; }); if (i >= 0) all[i] = current;
        var msg = statusChanged && replyChanged && reply ? 'Suggestion "' + s.title + '" is now ' + stName(st) + ', with a reply from the team.'
          : statusChanged ? 'Suggestion "' + s.title + '" is now ' + stName(st) + (st === 'shipped' && build ? ' (build ' + build + ')' : '') + '.'
            : replyChanged && reply ? 'The team replied to the suggestion "' + s.title + '".' : '';
        var n = msg && $('sg-a-notify').checked ? notifyAll(current, msg) : Promise.resolve(0);
        return n.then(function (k) { toast('success', 'Saved' + (k ? '. Notified ' + k + (k === 1 ? ' member' : ' members') : '') + '.'); renderDetail(); });
      }).catch(function (e) { console.warn(e); btn.disabled = false; toast('error', 'Could not save.'); });
    });
    $('sg-a-hide').addEventListener('click', function () {
      col().doc(s.id).update({ hidden: !s.hidden, updatedAt: ST() }).then(function () { s.hidden = !s.hidden; toast('success', s.hidden ? 'Hidden from the board.' : 'Visible again.'); renderDetail(); })
        .catch(function () { toast('error', 'Could not change it.'); });
    });
    $('sg-a-del').addEventListener('click', function () {
      if (!confirm('Delete this suggestion for good? Votes and comments stop showing. Hide is usually enough.')) return;
      col().doc(s.id).delete().then(function () { all = all.filter(function (x) { return x.id !== s.id; }); toast('success', 'Deleted.'); location.hash = ''; })
        .catch(function () { toast('error', 'Could not delete.'); });
    });
    $('sg-a-ban').addEventListener('click', function () {
      if (!confirm('Stop ' + (s.authorName || 'this member') + ' from posting suggestions and comments? They can still vote.')) return;
      db.collection('suggestBans').doc(s.authorUid).set({ at: ST(), by: me.uid, sid: s.id }).then(function () { toast('success', 'Banned from posting.'); })
        .catch(function () { toast('error', 'Could not ban.'); });
    });
    $('sg-a-mergebtn').addEventListener('click', function () {
      var otherId = $('sg-a-merge').value; if (!otherId) { toast('info', 'Choose the duplicate to merge with.'); return; }
      var other = all.filter(function (x) { return x.id === otherId; })[0]; if (!other) return;
      var keep = ms(s.createdAt) <= ms(other.createdAt) ? s : other, drop = keep === s ? other : s;
      if (!confirm('Merge "' + drop.title + '" into the older "' + keep.title + '"? Its votes move over (one per member) and it is hidden.')) return;
      mergeInto(keep, drop);
    });
  }
  function mergeInto(keep, drop) {
    Promise.all([voterUids(keep.id), voterUids(drop.id)]).then(function (r) {
      var have = {}; r[0].forEach(function (u) { have[u] = 1; });
      var moved = r[1].filter(function (u) { return !have[u]; }), t = today(), writes = [];
      moved.forEach(function (u) { writes.push(['set', col().doc(keep.id).collection('votes').doc(u), { uid: u, at: ST(), day: t }]); });
      r[1].forEach(function (u) { writes.push(['delete', col().doc(drop.id).collection('votes').doc(u)]); });
      var chunks = []; for (var i = 0; i < writes.length; i += 400) chunks.push(writes.slice(i, i + 400));
      return chunks.reduce(function (p, ch) {
        return p.then(function () { var b = db.batch(); ch.forEach(function (w) { if (w[0] === 'set') b.set(w[1], w[2]); else b.delete(w[1]); }); return b.commit(); });
      }, Promise.resolve()).then(function () {
        var b = db.batch();
        b.update(col().doc(keep.id), { votes: INC(moved.length), updatedAt: ST() });
        b.update(col().doc(drop.id), { votes: 0, mergedInto: keep.id, hidden: true, updatedAt: ST() });
        return b.commit();
      }).then(function () {
        keep.votes = (keep.votes || 0) + moved.length; drop.votes = 0; drop.mergedInto = keep.id; drop.hidden = true;
        if (me && myVotes[drop.id] && !myVotes[keep.id]) myVotes[keep.id] = { day: t };
        toast('success', 'Merged. ' + moved.length + ' vote' + (moved.length === 1 ? '' : 's') + ' moved.');
        if (location.hash.slice(1) === keep.id) renderDetail(); else location.hash = keep.id;
      });
    }).catch(function (e) { console.warn(e); toast('error', 'Merge failed part-way. Check both suggestions.'); });
  }

  // ---------- load ----------
  function load() {
    var qy = isAdmin ? col().limit(1000) : col().where('hidden', '==', false).limit(1000);
    return qy.get().then(function (snap) {
      all = snap.docs.map(function (d) { return Object.assign({ id: d.id }, d.data()); });
      loaded = true;
      return loadMyVotes(all.filter(function (s) { return !s.mergedInto; }).map(function (s) { return s.id; }));
    }).then(function () { renderList(); route(); }).catch(function (e) {
      console.warn('TradeZoro: suggestions load failed', e); loaded = true; all = [];
      $('sg-list').innerHTML = ''; var em = $('sg-empty'); em.hidden = false; em.textContent = 'Could not load suggestions. Check your connection and try again.';
      route();
    });
  }
  var started = false;
  function start(user) {
    me = user || null;
    if (!me) { load(); return; }
    Promise.all([
      db.collection('admins').doc(me.uid).get().then(function (d) { isAdmin = d.exists; }).catch(function () {}),
      db.collection('profiles').doc(me.uid).get().then(function (d) { var n = d.exists ? String((d.data() || {}).displayName || '') : ''; myName = n && n.length <= 60 ? n : 'Member'; }).catch(function () {}),
      db.collection('suggestMeta').doc(me.uid).get().then(function (d) { meta = d.exists ? d.data() : null; }).catch(function () {}),
      db.collection('suggestBans').doc(me.uid).get().then(function (d) { banned = d.exists; }).catch(function () {})
    ]).then(load);
  }
  if (typeof auth !== 'undefined' && auth) {
    auth.onAuthStateChanged(function (u) {
      if (!started) { started = true; start(u); return; }
      if ((u && u.uid) !== (me && me.uid)) location.reload();
    });
  } else start(null);
})();
