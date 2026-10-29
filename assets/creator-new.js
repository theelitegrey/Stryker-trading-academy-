// Create-a-community flow (creator-new.html): 3 steps, one atomic batch.
// Depends on: creator.js (CH), firebase auth/firestore/storage, auth.js, progress.js (db).
// Batch = slugs/{slug} + communities/{slug} + owner member row + creatorMeta quota bump; the rules check all four together.
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var step = 1, tags = [], ok = false, checking = 0, files = { logo: null, cover: null }, user = null;

  function show() {
    document.querySelectorAll('[data-step]').forEach(function (s) { s.hidden = +s.dataset.step !== step; });
    document.querySelectorAll('#cn-steps span').forEach(function (s, i) { s.classList.toggle('on', i < step); });
    $('cn-back').hidden = step === 1;
    $('cn-next').textContent = step === 3 ? 'Create community' : 'Next';
    $('cn-err').textContent = '';
    window.scrollTo(0, 0);
  }
  function err(m) { $('cn-err').textContent = m; }

  // topics
  $('cn-tags').innerHTML = CH.TAGS.map(function (t) { return '<label><input type="checkbox" value="' + t[0] + '"> ' + t[1] + '</label>'; }).join('');
  $('cn-tags').addEventListener('change', function (e) {
    tags = [].slice.call(document.querySelectorAll('#cn-tags input:checked')).map(function (i) { return i.value; });
    if (tags.length > 3) { e.target.checked = false; tags.pop(); err('Pick up to 3 topics.'); } else err('');
  });

  // slug availability
  var slugEdited = false, timer = null;
  $('cn-name').addEventListener('input', function () { if (!slugEdited) { $('cn-slug').value = CH.slugify($('cn-name').value); checkSlug(); } });
  $('cn-slug').addEventListener('input', function () { slugEdited = true; this.value = this.value.toLowerCase().replace(/[^a-z0-9-]/g, ''); checkSlug(); });
  function checkSlug() {
    var s = $('cn-slug').value, out = $('cn-avail'); ok = false;
    $('cn-slugshow').textContent = s || 'your-name';
    clearTimeout(timer);
    if (!s) { out.textContent = ''; return; }
    if (!CH.slugOk(s)) { out.className = 'cx-bad'; out.textContent = s.length < 3 ? 'Use at least 3 characters.' : 'Not allowed. Use letters, numbers and single dashes.'; return; }
    out.className = 'cx-muted'; out.textContent = 'Checking…';
    var n = ++checking;
    timer = setTimeout(function () {
      db.collection('slugs').doc(s).get().then(function (d) {
        if (n !== checking) return;
        ok = !d.exists; out.className = ok ? 'cx-ok' : 'cx-bad'; out.textContent = ok ? 'Available' : 'Already taken';
      }).catch(function () { if (n === checking) { out.className = 'cx-bad'; out.textContent = 'Could not check. Try again.'; } });
    }, 300);
  }

  // images
  ['logo', 'cover'].forEach(function (k) {
    $('cn-' + k).addEventListener('change', function () {
      var f = this.files[0], p = $('cn-' + k + '-p');
      if (!f) { files[k] = null; p.hidden = true; return; }
      if (!/^image\/(png|jpeg|webp)$/.test(f.type) || f.size > 5 * 1024 * 1024) { this.value = ''; files[k] = null; p.hidden = true; err('Images must be PNG, JPG or WebP, up to 5 MB.'); return; }
      files[k] = f; p.src = URL.createObjectURL(f); p.hidden = false; err('');
    });
  });
  $('cn-video').addEventListener('input', function () { $('cn-video-h').textContent = CH.videoOk(this.value.trim()) ? '' : 'Use a YouTube, Vimeo or Loom link starting with https://'; });
  ['cn-tagline', 'cn-about', 'cn-pdesc'].forEach(function (id) { $(id).addEventListener('input', function () { CH.warnIf(this); }); });

  // plan type
  $('cn-ptype').addEventListener('change', function () {
    var paid = document.querySelector('input[name=ptype]:checked').value === 'paid';
    $('cn-paid').hidden = !paid;
    if (!paid && $('cn-pname').value === 'Standard') $('cn-pname').value = 'Free';
    if (paid && $('cn-pname').value === 'Free') $('cn-pname').value = 'Standard';
  });

  function validate() {
    if (step === 1) {
      var n = $('cn-name').value.trim();
      if (n.length < 3) return 'Give your community a name (3 to 50 characters).';
      if (!CH.slugOk($('cn-slug').value)) return 'Choose a valid web address.';
      if (!ok) return 'That web address is not available yet. Wait for the check or pick another.';
      if (!tags.length) return 'Pick at least one topic.';
    }
    if (step === 2) {
      if (!CH.videoOk($('cn-video').value.trim())) return 'The intro video must be a YouTube, Vimeo or Loom link.';
      if (CH.RISKY.test($('cn-tagline').value + ' ' + $('cn-about').value)) return 'Please remove wording like "guaranteed", "100%" or "risk-free". It breaks the Creator Rules.';
    }
    if (step === 3) {
      if (!$('cn-pname').value.trim()) return 'Name your first plan.';
      if (document.querySelector('input[name=ptype]:checked').value === 'paid') {
        var a = +$('cn-pamt').value; if (!(a >= 1 && a <= 100000)) return 'Enter a price between 1 and 100000.';
      }
      if (CH.RISKY.test($('cn-pdesc').value)) return 'Please remove wording like "guaranteed" or "risk-free" from the plan description.';
      if (!$('cn-rules').checked) return 'Please agree to the Creator Rules.';
    }
    return '';
  }

  var busy = false;
  function create() {
    if (busy) return; busy = true; $('cn-next').disabled = true; $('cn-next').textContent = 'Creating…';
    var cid = $('cn-slug').value, paid = document.querySelector('input[name=ptype]:checked').value === 'paid';
    var metaRef = db.collection('creatorMeta').doc(user.uid), cRef = db.collection('communities').doc(cid);
    metaRef.get().then(function (m) {
      var count = m.exists ? m.data().count : 0;
      if (count >= CH.cfg.MAX_COMMUNITIES) throw { quota: true };
      var b = db.batch();
      b.set(db.collection('slugs').doc(cid), { ownerUid: user.uid, createdAt: CH.ts() });
      b.set(cRef, {
        ownerUid: user.uid, slug: cid, name: $('cn-name').value.trim(), ownerName: CH.displayName(user), tagline: $('cn-tagline').value.trim(), about: $('cn-about').value.trim(),
        logoUrl: '', coverUrl: '', introVideo: $('cn-video').value.trim(), accent: $('cn-accent').value,
        visibility: 'public', features: { feed: true, courses: false, indicators: false, events: false, leaderboard: false, discord: false },
        tags: tags, status: 'active', createdAt: CH.ts(), updatedAt: CH.ts(), memberCount: 1, founding: true, rulesAcceptedAt: CH.ts(), rulesVersion: CH.cfg.RULES_VERSION
      });
      b.set(cRef.collection('members').doc(user.uid), { uid: user.uid, planId: null, role: 'owner', source: 'owner', status: 'active', joinedAt: CH.ts(), expiresAt: null, lastActiveAt: CH.ts(), displayName: CH.displayName(user) });
      b.set(metaRef, { count: count + 1, cid: cid, updatedAt: CH.ts() });
      return b.commit();
    }).then(function () {
      var plan = {
        name: $('cn-pname').value.trim(), desc: $('cn-pdesc').value.trim(), bullets: [],
        price: paid ? { amount: +$('cn-pamt').value, currency: $('cn-pcur').value, interval: $('cn-pint').value } : { amount: 0, currency: 'USD', interval: 'free' },
        trialDays: 0, popular: false, status: paid ? 'draft' : 'live', joinMode: 'open', order: 0, updatedAt: CH.ts()
      };
      return cRef.collection('plans').doc('p1').set(plan);
    }).then(function () {
      var up = [], patch = {};
      ['logo', 'cover'].forEach(function (k) {
        if (!files[k]) return;
        var ref = firebase.storage().ref('communities/' + cid + '/branding/' + k);
        up.push(ref.put(files[k], { contentType: files[k].type }).then(function () { return ref.getDownloadURL(); }).then(function (u) { patch[k + 'Url'] = u; }).catch(function () { patch._failed = true; }));
      });
      return Promise.all(up).then(function () {
        var failed = patch._failed; delete patch._failed;
        if (!Object.keys(patch).length) return failed;
        patch.updatedAt = CH.ts();
        return cRef.update(patch).then(function () { return failed; });
      });
    }).then(function (imgFailed) {
      if (imgFailed) { try { sessionStorage.setItem('cx_note', 'Your community is live. One image did not upload; add it again in Settings.'); } catch (e) {} }
      location.href = '/creator?c=' + encodeURIComponent(cid) + '&new=1';
    }).catch(function (e) {
      busy = false; $('cn-next').disabled = false; $('cn-next').textContent = 'Create community';
      if (e && e.quota) err('You already have ' + CH.cfg.MAX_COMMUNITIES + ' communities. That is the limit for now.');
      else if (e && e.code === 'permission-denied') err('That address may have just been taken, or the community could not be created. Go back, change the address and try again.');
      else err('Could not create the community. Check your connection and try again.');
    });
  }

  $('cn-next').addEventListener('click', function () {
    var m = validate(); if (m) return err(m);
    if (step < 3) { step++; show(); } else create();
  });
  $('cn-back').addEventListener('click', function () { if (step > 1) { step--; show(); } });
  $('cn-form').addEventListener('submit', function (e) { e.preventDefault(); });

  CH.user().then(function (u) {
    if (!u) { $('cn-gate').innerHTML = 'Sign in to start a community.<div style="margin-top:14px"><button class="btn btn-primary" type="button" id="cn-login">Sign in</button></div>'; $('cn-login').onclick = CH.signIn; return; }
    user = u;
    $('cn-gate').hidden = true; $('cn-form').hidden = false; show();
  });
})();
