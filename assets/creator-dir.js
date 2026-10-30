// Communities directory (communities.html): public list, search, sort, topic filter, "My communities".
// Depends on: creator.js (CH), firebase auth/firestore, progress.js (db).
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var all = [], mine = [], tag = '', view = 'all', me = null;

  $('cd-tags').innerHTML = '<button type="button" class="cx-chip on" data-t="">All topics</button>' + CH.TAGS.map(function (t) { return '<button type="button" class="cx-chip" data-t="' + t[0] + '">' + t[1] + '</button>'; }).join('');
  $('cd-tags').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return; tag = b.dataset.t; resetPg();
    $('cd-tags').querySelectorAll('button').forEach(function (x) { x.classList.toggle('on', x === b); }); render();
  });
  $('cd-q').addEventListener('input', function () { resetPg(); render(); }); $('cd-sort').addEventListener('change', function () { resetPg(); render(); });
  if (new URLSearchParams(location.search).get('view') === 'mine') view = 'mine';
  $('cd-tabs').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return; view = b.dataset.t; resetPg();
    try { history.replaceState(null, '', location.pathname + (view === 'mine' ? '?view=mine' : '')); window.dispatchEvent(new Event('cn:route')); } catch (x) {}
    $('cd-tabs').querySelectorAll('button').forEach(function (x) { x.classList.toggle('active', x === b); }); render();
  });

  var cdPager = null, resetPg = function () { if (cdPager) cdPager.reset(); };
  function render() {
    var q = $('cd-q').value.trim().toLowerCase(), list = (view === 'mine' ? mine : all).filter(function (c) {
      return (!tag || (c.tags || []).indexOf(tag) >= 0) && (!q || (c.name + ' ' + (c.tagline || '')).toLowerCase().indexOf(q) >= 0);
    });
    var ms = function (c) { return c.createdAt && c.createdAt.toMillis ? c.createdAt.toMillis() : 0; };
    list.sort($('cd-sort').value === 'members' ? function (a, b) { return (b.memberCount || 0) - (a.memberCount || 0) || ms(b) - ms(a); } : function (a, b) { return ms(b) - ms(a); });
    // Shared pager (assets/pager.js). Up to 200 communities are loaded once, so paging is client-side.
    if (!cdPager && window.StrykerPager) cdPager = StrykerPager.create({ after: $('cd-grid'), label: 'communities', sizes: [24, 48, 96], size: 24, scrollTo: '#cd-grid', onChange: render });
    var total = list.length;
    if (cdPager) { cdPager.setTotal(total); list = cdPager.slice(list); }
    $('cd-grid').innerHTML = list.map(CH.card).join('');
    var e = $('cd-empty'); e.hidden = total > 0;
    if (!total) e.innerHTML = view === 'mine' ? 'You have not joined any community yet.' : (all.length ? 'No communities match. Try a different search or topic.' : 'No communities yet. <a href="/creators" style="color:var(--gold-bright)">Be the first to start one</a>.');
  }

  db.collection('communities').where('visibility', '==', 'public').where('status', '==', 'active').orderBy('createdAt', 'desc').limit(200).get()
    .then(function (s) { all = s.docs.map(function (d) { var o = d.data(); o.slug = d.id; return o; }); render(); })
    .catch(function () { $('cd-empty').hidden = false; $('cd-empty').textContent = 'Could not load communities. Check your connection and try again.'; });

  CH.user().then(function (u) {
    me = u; if (!u) { if (view === 'mine') { view = 'all'; render(); } return; }
    $('cd-tabs').hidden = false;
    $('cd-tabs').querySelectorAll('button').forEach(function (x) { x.classList.toggle('active', x.dataset.t === view); });
    db.collectionGroup('members').where('uid', '==', u.uid).get().then(function (s) {
      var ids = s.docs.filter(function (d) { return CH.isActive(d.data()); }).map(function (d) { return d.ref.parent.parent.id; });
      return Promise.all(ids.map(function (id) { return db.collection('communities').doc(id).get(); }));
    }).then(function (ds) {
      mine = ds.filter(function (d) { return d.exists && d.data().status === 'active'; }).map(function (d) { var o = d.data(); o.slug = d.id; return o; });
      if (view === 'mine') render();
    }).catch(function () {});
  });
})();
