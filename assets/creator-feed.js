// Creator Hub community tabs: Feed, Events, Leaderboard (window.CHF), mounted by creator-c.js on /c/<slug>.
//   CHF.mount(el, 'feed'|'events'|'leaderboard', { cid, cm, mem, me, isOwner })
// Depends on: creator.js (CH), firebase firestore, progress.js (db).
// Rules: functions-src/firestore.rules "community feed, events, leaderboard". Members only. All text is escaped; no HTML is ever stored.
// The leaderboard writes nothing: it counts posts and comments of the last 30 days (2 points per post, 1 per comment).
(function () {
  var E = function (s) { return CH.esc(s); };
  var C, root, staff = false, mod = false;
  var $ = function (id) { return document.getElementById(id); };
  var col = function (n) { return db.collection('communities').doc(C.cid).collection(n); };
  var DAYS = 30;

  function rid() { var a = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789', s = '', r = new Uint8Array(16); crypto.getRandomValues(r); for (var i = 0; i < 16; i++) s += a[r[i] % a.length]; return s; }
  function arr(s) { return s.docs.map(function (d) { var o = d.data(); o.id = d.id; return o; }); }
  function ms(t) { return t && t.toMillis ? t.toMillis() : (t ? +new Date(t) : 0); }
  function ago(t) {
    var s = Math.max(0, (Date.now() - ms(t)) / 1000);
    if (s < 60) return 'just now'; if (s < 3600) return Math.floor(s / 60) + ' min ago'; if (s < 86400) return Math.floor(s / 3600) + ' h ago';
    if (s < 86400 * 7) return Math.floor(s / 86400) + ' d ago'; return CH.date(t);
  }
  function fail(e) { CH.toast('error', e && e.code === 'permission-denied' ? 'Not allowed right now. Reload the page and try again.' : 'Something went wrong. Try again.'); }
  function name() { return CH.displayName(C.me).slice(0, 60); }
  function initial(n) { return E(String(n || '?').trim().charAt(0).toUpperCase() || '?'); }
  function gate(el) {
    if (!C.me) { el.innerHTML = '<div class="cx-empty">Sign in to see this.<div style="margin-top:14px"><button type="button" class="btn btn-primary" id="cf-in">Sign in</button></div></div>'; $('cf-in').onclick = C.signIn; return true; }
    if (!C.member && !C.isOwner) { el.innerHTML = '<div class="cx-empty">This is for members. Join a plan on the About tab to see it.</div>'; return true; }
    return false;
  }

  // ---------------------------------------------------------------- feed
  var posts = [], open = {}, FEED_PAGE = 30, feedCursor = null, feedMore = false, feedBusy = false;
  function loadMorePosts() {
    if (feedBusy || !feedCursor) return; feedBusy = true;
    var b = $('cf-more'); if (b) { b.disabled = true; b.textContent = 'Loading…'; }
    col('posts').orderBy('createdAt', 'desc').startAfter(feedCursor).limit(FEED_PAGE).get().then(function (s) {
      var seen = {}; posts.forEach(function (p) { seen[p.id] = 1; });
      arr(s).forEach(function (p) { if (!seen[p.id]) posts.push(p); });
      if (s.docs.length) feedCursor = s.docs[s.docs.length - 1];
      feedMore = s.docs.length >= FEED_PAGE; feedBusy = false; drawFeed();
    }).catch(function (e) { feedBusy = false; fail(e); drawFeed(); });
  }
  function postHtml(p) {
    var mine = C.me && p.authorUid === C.me.uid, can = mine || mod;
    return '<article class="cx-box cf-post" data-p="' + E(p.id) + '"><div class="cf-h"><span class="cf-av" aria-hidden="true">' + initial(p.authorName) + '</span>' +
      '<div class="cf-who"><b>' + E(p.authorName) + '</b>' + (p.authorUid === C.cm.ownerUid ? ' <span class="cx-chip on">Creator</span>' : '') + (p.pinned ? ' <span class="cx-chip">Pinned</span>' : '') +
      '<div class="cx-muted">' + E(ago(p.createdAt)) + (p.editedAt ? ' · edited' : '') + '</div></div></div>' +
      '<p class="cf-t" id="cf-t-' + E(p.id) + '">' + E(p.text) + '</p>' +
      (/^https:\/\/[^ "<>]{4,500}$/.test(p.imageUrl || '') ? '<img class="cf-img" src="' + E(p.imageUrl) + '" alt="' + E(p.imageAlt || 'Image in post') + '" loading="lazy">' : '') +
      '<div class="cf-act"><button type="button" class="btn btn-ghost cx-sm cf-cm" data-p="' + E(p.id) + '">' + (open[p.id] ? 'Hide comments' : 'Comments' + (p.commentCount ? ' · ' + (+p.commentCount | 0) : '')) + '</button>' +
      (p.likeCount > 0 ? '<span class="cf-likes cx-muted" aria-label="' + (+p.likeCount | 0) + ' likes">' + (+p.likeCount | 0) + ' likes</span>' : '') +
      (mod ? '<button type="button" class="btn btn-ghost cx-sm cf-pin" data-p="' + E(p.id) + '">' + (p.pinned ? 'Unpin' : 'Pin') + '</button>' : '') +
      (mine ? '<button type="button" class="btn btn-ghost cx-sm cf-ed" data-p="' + E(p.id) + '">Edit</button>' : '') +
      (can ? '<button type="button" class="btn btn-ghost cx-sm cf-del" data-p="' + E(p.id) + '">Delete</button>' : '') +
      '</div><div class="cf-cs" id="cf-cs-' + E(p.id) + '"' + (open[p.id] ? '' : ' hidden') + '></div></article>';
  }
  function drawFeed() {
    var list = posts.slice().sort(function (a, b) { return (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || ms(b.createdAt) - ms(a.createdAt); });
    $('cf-list').innerHTML = list.length ? list.map(postHtml).join('') : '<div class="cx-empty">No posts yet. Be the first to post.</div>';
    var mb = $('cf-more'); if (mb) mb.remove();
    if (feedMore && list.length) { var more = document.createElement('button'); more.type = 'button'; more.id = 'cf-more'; more.className = 'btn btn-ghost szp-more'; more.textContent = 'Load more posts'; more.onclick = loadMorePosts; $('cf-list').parentNode.insertBefore(more, $('cf-list').nextSibling); }
    $('cf-list').querySelectorAll('.cf-cm').forEach(function (b) { b.onclick = function () { toggleComments(b.dataset.p); }; });
    $('cf-list').querySelectorAll('.cf-pin').forEach(function (b) { b.onclick = function () { var p = find(b.dataset.p); col('posts').doc(p.id).update({ pinned: !p.pinned }).then(function () { p.pinned = !p.pinned; drawFeed(); }).catch(fail); }; });
    $('cf-list').querySelectorAll('.cf-del').forEach(function (b) { b.onclick = function () {
      if (!confirm('Delete this post? Its comments stay hidden with it.')) return;
      col('posts').doc(b.dataset.p).delete().then(function () { posts = posts.filter(function (x) { return x.id !== b.dataset.p; }); drawFeed(); }).catch(fail); }; });
    $('cf-list').querySelectorAll('.cf-ed').forEach(function (b) { b.onclick = function () { editPost(find(b.dataset.p)); }; });
    Object.keys(open).forEach(function (id) { if (open[id] && find(id)) loadComments(id); });
  }
  function find(id) { return posts.filter(function (x) { return x.id === id; })[0]; }
  function editPost(p) {
    var t = $('cf-t-' + p.id); t.outerHTML = '<div class="cx-f" id="cf-e-' + E(p.id) + '"><textarea maxlength="2000" aria-label="Edit post">' + E(p.text) + '</textarea><div class="cx-row"><button type="button" class="btn btn-primary cx-sm" id="cf-es">Save</button><button type="button" class="btn btn-ghost cx-sm" id="cf-ec">Cancel</button></div></div>';
    var box = $('cf-e-' + p.id); box.querySelector('textarea').focus();
    $('cf-ec').onclick = drawFeed;
    $('cf-es').onclick = function () {
      var v = box.querySelector('textarea').value.trim(); if (!v) return CH.toast('error', 'Write something first.');
      if (CH.RISKY.test(v)) return CH.toast('error', 'Remove wording like "guaranteed", "100%" or "risk-free".');
      col('posts').doc(p.id).update({ text: v, editedAt: CH.ts() }).then(function () { p.text = v; p.editedAt = new Date(); drawFeed(); }).catch(fail);
    };
  }
  function toggleComments(id) { open[id] = !open[id]; var b = $('cf-cs-' + id); if (!open[id]) { b.hidden = true; drawFeed(); return; } drawFeed(); }
  function loadComments(id) {
    var box = $('cf-cs-' + id); box.hidden = false; box.innerHTML = '<div class="cx-muted">Loading…</div>';
    col('comments').where('postId', '==', id).limit(100).get().then(function (s) {
      var cs = arr(s).sort(function (a, b) { return ms(a.createdAt) - ms(b.createdAt); });
      box.innerHTML = cs.map(function (k) {
        var can = C.me && (k.authorUid === C.me.uid || mod);
        return '<div class="cf-c"><span class="cf-av cf-av-s" aria-hidden="true">' + initial(k.authorName) + '</span><div class="cf-cb"><b>' + E(k.authorName) + '</b> <span class="cx-muted">' + E(ago(k.createdAt)) + '</span><p>' + E(k.text) + '</p></div>' +
          (can ? '<button type="button" class="cx-x cf-kd" data-k="' + E(k.id) + '" aria-label="Delete comment">&times;</button>' : '') + '</div>';
      }).join('') +
        '<form class="cf-cf" data-p="' + E(id) + '"><input class="cx-in" type="text" maxlength="1000" placeholder="Write a comment" aria-label="Write a comment"><button class="btn btn-primary cx-sm" type="submit">Send</button></form>';
      box.querySelectorAll('.cf-kd').forEach(function (b) { b.onclick = function () { col('comments').doc(b.dataset.k).delete().then(function () { loadComments(id); }).catch(fail); }; });
      box.querySelector('form').onsubmit = function (e) {
        e.preventDefault(); var inp = this.querySelector('input'), v = inp.value.trim(); if (!v) return;
        if (CH.RISKY.test(v)) return CH.toast('error', 'Remove wording like "guaranteed", "100%" or "risk-free".');
        inp.disabled = true;
        col('comments').doc(rid()).set({ postId: id, authorUid: C.me.uid, authorName: name(), text: v, createdAt: CH.ts() }).then(function () { loadComments(id); }).catch(function (x) { inp.disabled = false; fail(x); });
      };
    }).catch(function () { box.innerHTML = '<div class="cx-muted">Could not load comments.</div>'; });
  }
  function feed(el) {
    el.innerHTML = '<div class="cx-box"><form class="cx-f" id="cf-form" novalidate><label for="cf-new">Share with the community</label><textarea id="cf-new" maxlength="2000" placeholder="What are you working on?"></textarea>' +
      '<div class="hint">Education only. Not financial advice. Do not post profit claims or tips to follow.</div><div id="cf-err" class="cx-bad" role="alert"></div><div class="cx-actions"><button class="btn btn-primary" type="submit" id="cf-send">Post</button></div></form></div>' +
      '<div id="cf-list" style="margin-top:14px"><div class="cx-empty">Loading…</div></div>';
    $('cf-new').addEventListener('input', function () { CH.warnIf(this); });
    $('cf-form').onsubmit = function (e) {
      e.preventDefault(); var v = $('cf-new').value.trim(), err = $('cf-err'); err.textContent = '';
      if (!v) return err.textContent = 'Write something first.';
      if (CH.RISKY.test(v)) return err.textContent = 'Remove wording like "guaranteed", "100%" or "risk-free". It breaks the Creator Rules.';
      $('cf-send').disabled = true;
      var id = rid();
      col('posts').doc(id).set({ authorUid: C.me.uid, authorName: name(), text: v, pinned: false, createdAt: CH.ts() })
        .then(function () { $('cf-new').value = ''; $('cf-send').disabled = false; return load(); }).catch(function (x) { $('cf-send').disabled = false; err.textContent = 'Could not post. Check your connection and try again.'; });
    };
    load();
    function load() {
      // Cursor pagination (Owner 2026-10-30): 30 posts per read, "Load more" fetches the next 30 with startAfter.
      return col('posts').orderBy('createdAt', 'desc').limit(FEED_PAGE).get().then(function (s) { posts = arr(s); feedCursor = s.docs.length ? s.docs[s.docs.length - 1] : null; feedMore = s.docs.length >= FEED_PAGE; drawFeed(); })
        .catch(function () { $('cf-list').innerHTML = '<div class="cx-empty">Could not load the feed. Reload the page.</div>'; });
    }
  }

  // ---------------------------------------------------------------- events
  function when(t, mins) {
    var d = t.toDate ? t.toDate() : new Date(t), e = new Date(+d + mins * 60000);
    return d.toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) + ' – ' + e.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }
  function toLocalInput(d) { var z = new Date(d.getTime() - d.getTimezoneOffset() * 60000); return z.toISOString().slice(0, 16); }
  function events(el) {
    el.innerHTML = (staff ? '<div class="cx-spread" style="margin-bottom:12px"><h2 style="margin:0">Events</h2><button type="button" class="btn btn-primary" id="ev-new">New event</button></div>' : '') + '<div id="ev-list"><div class="cx-empty">Loading…</div></div>';
    if (staff) $('ev-new').onclick = function () { evForm(null); };
    col('events').orderBy('startsAt', 'desc').limit(60).get().then(function (s) {
      var all = arr(s), now = Date.now(), up = all.filter(function (x) { return ms(x.startsAt) + x.durationMin * 60000 >= now; }).sort(function (a, b) { return ms(a.startsAt) - ms(b.startsAt); }),
        past = all.filter(function (x) { return ms(x.startsAt) + x.durationMin * 60000 < now; }).slice(0, 10);
      return Promise.all(all.map(function (ev) {
        return col('events').doc(ev.id).collection('rsvps').get().then(function (r) { ev._n = r.size; ev._me = !!(C.me && r.docs.some(function (d) { return d.id === C.me.uid; })); }).catch(function () { ev._n = 0; });
      })).then(function () { $('ev-list').innerHTML = (up.length ? up.map(evCard).join('') : '<div class="cx-empty">No upcoming events.</div>') + (past.length ? '<h3 style="margin:22px 0 8px">Past events</h3>' + past.map(evCard).join('') : ''); bindEv(all); });
    }).catch(function () { $('ev-list').innerHTML = '<div class="cx-empty">Could not load events. Reload the page.</div>'; });
  }
  function evCard(ev) {
    var past = ms(ev.startsAt) + ev.durationMin * 60000 < Date.now();
    return '<article class="cx-box cf-ev' + (past ? ' past' : '') + '"><div class="cf-evd" aria-hidden="true"><b>' + E((ev.startsAt.toDate ? ev.startsAt.toDate() : new Date(ev.startsAt)).getDate()) + '</b><span>' +
      E((ev.startsAt.toDate ? ev.startsAt.toDate() : new Date(ev.startsAt)).toLocaleDateString(undefined, { month: 'short' })) + '</span></div><div class="cf-evb"><h3>' + E(ev.title) + '</h3><div class="cx-muted">' + E(when(ev.startsAt, ev.durationMin)) + '</div>' +
      (ev.desc ? '<p>' + E(ev.desc) + '</p>' : '') + '<div class="cx-row">' +
      (past ? '' : '<button type="button" class="btn ' + (ev._me ? 'btn-ghost' : 'btn-primary') + ' cx-sm ev-go" data-e="' + E(ev.id) + '">' + (ev._me ? 'Going · cancel' : 'I\'m going') + '</button>') +
      (ev.link && !past ? '<a class="btn btn-ghost cx-sm" href="' + E(ev.link) + '" target="_blank" rel="noopener noreferrer">Open link</a>' : '') +
      '<span class="cx-muted">' + ev._n + ' going</span>' +
      (staff ? '<button type="button" class="btn btn-ghost cx-sm ev-ed" data-e="' + E(ev.id) + '">Edit</button>' : '') + '</div></div></article>';
  }
  function bindEv(all) {
    root.querySelectorAll('.ev-go').forEach(function (b) { b.onclick = function () {
      var ref = col('events').doc(b.dataset.e).collection('rsvps').doc(C.me.uid), ev = all.filter(function (x) { return x.id === b.dataset.e; })[0]; b.disabled = true;
      (ev._me ? ref.delete() : ref.set({ uid: C.me.uid, name: name(), createdAt: CH.ts() })).then(function () { events(root); }).catch(function (x) { b.disabled = false; fail(x); });
    }; });
    root.querySelectorAll('.ev-ed').forEach(function (b) { b.onclick = function () { evForm(all.filter(function (x) { return x.id === b.dataset.e; })[0]); }; });
  }
  function evForm(ev) {
    var bg = document.createElement('div'); bg.className = 'cx-sheet-bg';
    var d = ev ? (ev.startsAt.toDate ? ev.startsAt.toDate() : new Date(ev.startsAt)) : new Date(Date.now() + 86400000);
    bg.innerHTML = '<div class="cx-sheet" role="dialog" aria-modal="true" aria-label="' + (ev ? 'Edit event' : 'New event') + '"><div class="cx-sheet-h"><h2>' + (ev ? 'Edit event' : 'New event') + '</h2><button type="button" class="cx-x" aria-label="Close" id="evf-x">&times;</button></div><div class="cx-sheet-b">' +
      '<form class="cx-f" id="evf" novalidate><div><label for="evf-t">Title</label><input id="evf-t" type="text" maxlength="100" value="' + E(ev ? ev.title : '') + '"></div>' +
      '<div><label for="evf-d">Details (optional)</label><textarea id="evf-d" maxlength="1000">' + E(ev ? ev.desc : '') + '</textarea></div>' +
      '<div class="cx-row"><div style="flex:1 1 200px"><label for="evf-s">Starts</label><input id="evf-s" type="datetime-local" value="' + toLocalInput(d) + '"></div><div style="flex:1 1 120px"><label for="evf-m">Length (minutes)</label><input id="evf-m" type="number" min="5" max="600" step="5" value="' + (ev ? ev.durationMin : 60) + '"></div></div>' +
      '<div><label for="evf-l">Meeting link (optional)</label><input id="evf-l" type="url" inputmode="url" placeholder="https://" value="' + E(ev ? ev.link : '') + '"><div class="hint">Zoom, Google Meet, YouTube Live or similar. Only members see it.</div></div>' +
      '<div id="evf-err" class="cx-bad" role="alert"></div><div class="cx-actions">' + (ev ? '<button type="button" class="btn btn-ghost" id="evf-del">Delete event</button>' : '') + '<button class="btn btn-primary" type="submit">Save</button></div></form></div></div>';
    document.body.appendChild(bg); var close = function () { bg.remove(); }; $('evf-x').onclick = close; bg.addEventListener('mousedown', function (e) { if (e.target === bg) close(); });
    $('evf-t').focus();
    if (ev) $('evf-del').onclick = function () { if (!confirm('Delete this event?')) return; col('events').doc(ev.id).delete().then(function () { close(); events(root); }).catch(fail); };
    $('evf').onsubmit = function (e) {
      e.preventDefault(); var err = $('evf-err'); err.textContent = '';
      var t = $('evf-t').value.trim(), s = new Date($('evf-s').value), m = +$('evf-m').value, l = $('evf-l').value.trim(), ds = $('evf-d').value.trim();
      if (t.length < 2) return err.textContent = 'Give the event a title.';
      if (isNaN(+s)) return err.textContent = 'Pick a start time.';
      if (!(m >= 5 && m <= 600 && m % 1 === 0)) return err.textContent = 'Length is 5 to 600 minutes.';
      if (l && !/^https:\/\/\S{4,480}$/.test(l)) return err.textContent = 'The link must start with https://';
      if (CH.RISKY.test(t + ' ' + ds)) return err.textContent = 'Remove wording like "guaranteed", "100%" or "risk-free".';
      var doc = { title: t, desc: ds, startsAt: CH.stamp(s), durationMin: m, link: l, createdBy: ev ? ev.createdBy : C.me.uid, createdAt: ev ? ev.createdAt : CH.ts() };
      col('events').doc(ev ? ev.id : rid()).set(doc).then(function () { close(); events(root); }).catch(function () { err.textContent = 'Could not save the event. Check the values.'; });
    };
  }

  // ---------------------------------------------------------------- leaderboard
  function board(el) {
    el.innerHTML = '<div class="cx-empty">Loading…</div>';
    var since = CH.stamp(new Date(Date.now() - DAYS * 86400000));
    Promise.all([col('posts').where('createdAt', '>=', since).limit(500).get(), col('comments').where('createdAt', '>=', since).limit(1000).get()]).then(function (r) {
      var by = {};
      function add(d, k, pts) { var o = by[d.authorUid] || (by[d.authorUid] = { uid: d.authorUid, name: d.authorName, posts: 0, comments: 0, pts: 0 }); o[k]++; o.pts += pts; o.name = d.authorName || o.name; }
      r[0].docs.forEach(function (d) { add(d.data(), 'posts', 2); });
      r[1].docs.forEach(function (d) { add(d.data(), 'comments', 1); });
      var list = Object.keys(by).map(function (k) { return by[k]; }).sort(function (a, b) { return b.pts - a.pts || a.name.localeCompare(b.name); }).slice(0, 20);
      el.innerHTML = '<div class="cx-box"><h2>Most active, last ' + DAYS + ' days</h2><p class="cx-muted" style="margin:0 0 12px">2 points for a post, 1 for a comment. This counts community activity only. It is not a trading ranking.</p>' +
        (list.length ? '<ol class="cf-lb">' + list.map(function (x, i) {
          return '<li' + (C.me && x.uid === C.me.uid ? ' class="me"' : '') + '><span class="cf-rk">' + (i + 1) + '</span><span class="cf-av cf-av-s" aria-hidden="true">' + initial(x.name) + '</span><span class="cf-ln"><b>' + E(x.name) + '</b><span class="cx-muted">' + x.posts + ' post' + (x.posts === 1 ? '' : 's') + ' · ' + x.comments + ' comment' + (x.comments === 1 ? '' : 's') + '</span></span><span class="cf-pt">' + x.pts + '</span></li>';
        }).join('') + '</ol>' : '<div class="cx-empty">No activity yet. Post in the Feed to get on the board.</div>') + '</div>';
    }).catch(function () { el.innerHTML = '<div class="cx-empty">Could not load the leaderboard. Reload the page.</div>'; });
  }

  window.CHF = {
    mount: function (el, which, c) {
      C = c; root = el; staff = !!(c.isOwner || (c.mem && c.mem.role === 'admin')); mod = !!(c.isOwner || (c.mem && ['admin', 'mod', 'owner'].indexOf(c.mem.role) >= 0));
      if (gate(el)) return;
      ({ feed: feed, events: events, leaderboard: board })[which](el);
    }
  };
})();
