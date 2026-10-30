// Creator Hub -> Indicators tab (creator.html). Plain script; creator-hub.js calls CHInd.view(el, ctx).
// ctx = { cid, cm, plans, members, reload() }.
// Publish flow (owner's browser): compile check on the real engine (creator-pine-check-worker.js) -> show the engine's
// error with its line -> build: comments stripped + (protected) own names replaced by markers (pine-obfuscate.js
// template()) -> sealed to the server's public key (creator-seal.js, CREATOR_CONFIG.SEAL_PUB) -> one batch:
// indicator doc + src/v<n> (plain, owner-only) + vault/v<n> (sealed, what delivery reads). Rules: firestore.rules
// "indicators" block. Members get the new version on their next chart load; older versions stay in src/.
(function () {
  'use strict';
  var E = function (s) { return CH.esc(s); };
  var $ = function (id) { return document.getElementById(id); };
  var MAX_SRC = 131072, MAX_SHOTS = 4;
  var ctx, inds = [], open = null, sub = 'list';
  var mods = null;
  function loadMods() {
    if (!mods) mods = Promise.all([import('/assets/pine-obfuscate.js?v=751'), import('/assets/creator-seal.js?v=751')]);
    return mods;
  }
  var checker = null, chkId = 0, chkWait = {};
  function compile(source) {
    if (!checker) {
      checker = new Worker('/assets/creator-pine-check-worker.js?v=751', { type: 'module', name: 'tz-pine-check' });
      checker.onmessage = function (e) { var w = chkWait[e.data.id]; if (w) { delete chkWait[e.data.id]; w(e.data); } };
      checker.onerror = function () { Object.keys(chkWait).forEach(function (k) { chkWait[k]({ ok: false, error: 'The Pine engine did not load. Check your connection.' }); delete chkWait[k]; }); checker = null; };
    }
    var id = ++chkId;
    return new Promise(function (res) { chkWait[id] = res; checker.postMessage({ id: id, source: source }); });
  }
  function iref(iid) { return db.collection('communities').doc(ctx.cid).collection('indicators').doc(iid); }
  function newId() { var a = new Uint8Array(16), c = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', s = ''; crypto.getRandomValues(a); for (var i = 0; i < a.length; i++) s += c[a[i] % 62]; return s; }
  function code() { return newId().slice(0, 12); }
  function guardOk(src) { try { return !window.StrykerPineGuard || window.StrykerPineGuard.check(src); } catch (e) { return { ok: false, msg: 'Safety check failed.' }; } }
  function day() { return Math.floor(Date.now() / 86400000); }
  function planName(id) { var p = ctx.plans.filter(function (x) { return x.id === id; })[0]; return p ? p.name : '(deleted plan)'; }
  function holdersOf(x) {
    // plan holders (active, unexpired, on an included plan) + active solo grants. Owner not counted.
    var plan = ctx.members.filter(function (m) { return m.role !== 'owner' && CH.isActive(m) && (x.planIds || []).indexOf(m.planId) >= 0; }).length;
    var solo = (x._access || []).filter(function (a) { return a.status === 'active' && (!a.expiresAt || a.expiresAt.toMillis() > Date.now()); }).length;
    return { plan: plan, solo: solo, total: plan + solo };
  }

  function view(el, c, keepId) {
    ctx = c;
    el.innerHTML = '<div class="cx-empty">Loading indicators…</div>';
    db.collection('communities').doc(ctx.cid).collection('indicators').get().then(function (s) {
      inds = s.docs.map(function (d) { var o = d.data(); o.id = d.id; return o; }).sort(function (a, b) { return (b.updatedAt ? b.updatedAt.toMillis() : 0) - (a.updatedAt ? a.updatedAt.toMillis() : 0); });
      return Promise.all(inds.map(function (x) {
        return Promise.all([iref(x.id).collection('access').get().catch(function () { return { docs: [] }; }),
          iref(x.id).collection('usage').get().catch(function () { return { docs: [] }; })]).then(function (r) {
          x._access = r[0].docs.map(function (d) { var o = d.data(); o.id = d.id; return o; });
          x._usage7 = r[1].docs.filter(function (d) { return (d.data().day || 0) > day() - 7; }).length;
        });
      }));
    }).then(function () {
      if (keepId) { open = inds.filter(function (z) { return z.id === keepId; })[0] || null; sub = open ? 'detail' : 'list'; }
      draw(el);
    }).catch(function () { el.innerHTML = '<div class="cx-empty">Could not load indicators. Try again.</div>'; });
  }

  function draw(el) {
    if (sub === 'form') return form(el, open);
    if (sub === 'detail' && open) return detail(el, open);
    var h = '<div class="cx-spread" style="margin-bottom:12px"><h2 style="margin:0">Indicators</h2><button class="btn btn-primary" id="in-new" type="button">Upload indicator</button></div>' +
      '<div class="cx-note">Your Pine indicators run on ZoroCharts for the people you choose. You decide access here: by plan, by email, or with an invite code. <b>Protected</b> indicators never send readable code to members. ' +
      (CH.cfg.PAYMENTS ? '' : '<b>Paid checkout opens soon</b>: you can set a price now; until then give access with free plans, invites and email grants.') + '</div>';
    if (!inds.length) h += '<div class="cx-empty">No indicators yet. Upload your first Pine script.</div>';
    else h += '<div class="cx-tablewrap"><table class="cx-table"><thead><tr><th>Indicator</th><th>Status</th><th>Version</th><th>Holders</th><th>Added 7d</th><th></th></tr></thead><tbody>' + inds.map(function (x, i) {
      var hd = holdersOf(x);
      return '<tr><td><b>' + E(x.name) + '</b>' + (x.protected ? ' <span class="cx-chip">Protected</span>' : '') + '<div class="cx-muted">' + ((x.planIds || []).map(planName).join(', ') || 'No plan') + (x.solo && x.solo.mode !== 'off' ? ' · alone: ' + E(soloLabel(x.solo)) : '') + '</div></td>' +
        '<td><span class="cx-chip' + (x.status === 'live' ? ' on' : '') + '">' + (x.status === 'live' ? 'Live' : x.status === 'hidden' ? 'Hidden by TradeZoro' : 'Draft') + '</span></td>' +
        '<td>v' + x.version + '</td><td>' + hd.total + '<div class="cx-muted">' + hd.plan + ' by plan · ' + hd.solo + ' alone</div></td><td>' + (x._usage7 || 0) + '</td>' +
        '<td><button class="btn btn-ghost in-open" data-i="' + i + '" type="button">Manage</button></td></tr>';
    }).join('') + '</tbody></table></div>';
    el.innerHTML = h;
    $('in-new').onclick = function () { open = null; sub = 'form'; draw(el); };
    el.querySelectorAll('.in-open').forEach(function (b) { b.onclick = function () { open = inds[+b.dataset.i]; sub = 'detail'; draw(el); }; });
  }
  function soloLabel(s) {
    if (!s || s.mode === 'off') return 'Not sold alone';
    if (s.mode === 'free') return 'Free';
    if (s.mode === 'invite') return 'Invite code or email';
    return CH.money({ price: { amount: s.price.amount, currency: s.price.currency, interval: 'lifetime' } }).replace(/ ?(once|lifetime)$/i, '') + (CH.cfg.PAYMENTS ? '' : ' (checkout opens soon)');
  }

  // ---------------------------------------------------------------- upload / new version / edit
  function form(el, x) {
    var editing = !!x;
    var tags = CH.cfg.IND_TAGS || [];
    var h = '<form class="cx-f cx-box" id="if" novalidate><div class="cx-spread"><h2 style="margin:0">' + (editing ? 'Edit ' + E(x.name) : 'Upload indicator') + '</h2><button class="btn btn-ghost" type="button" id="if-back">Back</button></div>' +
      '<div><label for="if-name">Name</label><input id="if-name" type="text" maxlength="60" value="' + E(editing ? x.name : '') + '"></div>' +
      '<div><label for="if-desc">Description</label><textarea id="if-desc" maxlength="2000">' + E(editing ? x.desc : '') + '</textarea></div>' +
      '<div><label for="if-notes">Settings notes <span class="cx-muted">(how to set it up)</span></label><textarea id="if-notes" maxlength="2000">' + E(editing ? x.settingsNotes : '') + '</textarea></div>' +
      '<div><label>Tags (up to 5)</label><div class="cx-pick" id="if-tags">' + tags.map(function (t) { return '<label><input type="checkbox" value="' + E(t) + '"' + (editing && (x.tags || []).indexOf(t) >= 0 ? ' checked' : '') + '> ' + E(t) + '</label>'; }).join('') + '</div></div>' +
      '<div><label for="if-shots">Screenshots (up to 4, PNG/JPG/WebP, 5 MB each)</label><input id="if-shots" type="file" accept="image/png,image/jpeg,image/webp" multiple>' +
      (editing && (x.shots || []).length ? '<div class="cx-row" style="margin-top:8px">' + x.shots.map(function (u) { return '<img class="cx-prev" style="max-width:120px" src="' + E(u) + '" alt="">'; }).join('') + '</div><div class="hint">Choosing new files replaces these.</div>' : '') + '</div>' +
      '<div><label for="if-src">Pine Script' + (editing ? ' (leave empty to keep v' + x.version + '; paste code to publish v' + (x.version + 1) + ')' : '') + '</label><textarea id="if-src" class="cx-code stkc-scroll" spellcheck="false" autocapitalize="off" autocomplete="off" wrap="off" style="min-height:220px;font-family:var(--font-mono);font-size:13px" placeholder="//@version=5&#10;indicator(&quot;My indicator&quot;, overlay=true)"></textarea><div class="hint">Up to 128 KB. We compile it on the same engine members\' charts use before it is published.</div></div>' +
      '<div id="if-vn-w"' + (editing ? ' hidden' : '') + '><label for="if-vn">Version notes</label><input id="if-vn" type="text" maxlength="1000" placeholder="' + (editing ? 'What changed in this version' : 'First release') + '"></div>' +
      '<div><label class="cx-check"><input type="checkbox" id="if-prot"' + (!editing || x.protected ? ' checked' : '') + '> Protected: members can use it, but never see, copy or export the code</label></div>' +
      '<div><label>Included in plans</label><div class="cx-pick" id="if-plans">' + (ctx.plans.length ? ctx.plans.map(function (p) { return '<label><input type="checkbox" value="' + E(p.id) + '"' + (editing && (x.planIds || []).indexOf(p.id) >= 0 ? ' checked' : '') + '> ' + E(p.name) + '</label>'; }).join('') : '<span class="cx-muted">No plans yet. Add one in Plans, or sell the indicator alone.</span>') + '</div></div>' +
      '<div class="cx-row"><div style="flex:1 1 200px"><label for="if-solo">Sell it alone</label><select id="if-solo"><option value="off">No, plans only</option><option value="free">Free for anyone who asks</option><option value="invite">By invite code or email</option><option value="paid">Paid (one-time price)</option></select></div>' +
      '<div style="flex:1 1 120px" id="if-pr-w"><label for="if-amt">Price</label><input id="if-amt" type="number" min="1" max="100000" step="1" value="' + (editing && x.solo && x.solo.price ? x.solo.price.amount || '' : '') + '"></div>' +
      '<div style="flex:0 1 110px" id="if-cur-w"><label for="if-cur">Currency</label><select id="if-cur"><option>USD</option><option>INR</option></select></div></div>' +
      (CH.cfg.PAYMENTS ? '' : '<div class="hint" id="if-paidnote">Paid checkout opens soon. The price is saved and shown; meanwhile give access by invite code or email.</div>') +
      '<div><label class="cx-check"><input type="checkbox" id="if-rules"> I agree to the <a href="/creator-rules" target="_blank" rel="noopener">Creator Rules</a> and own the rights to this code</label></div>' +
      '<div><label for="if-st">Status</label><select id="if-st"><option value="live">Live: members can use it</option><option value="draft">Draft: only you</option></select></div>' +
      '<div id="if-chk" class="cx-muted" role="status"></div><div id="if-err" class="cx-bad" role="alert"></div>' +
      '<div class="cx-actions"><button class="btn btn-ghost" type="button" id="if-test">Compile check</button><button class="btn btn-primary" type="submit" id="if-save">' + (editing ? 'Save' : 'Publish') + '</button></div></form>';
    el.innerHTML = h;
    var solo = editing && x.solo ? x.solo : { mode: 'off', price: { amount: 0, currency: 'USD' } };
    $('if-solo').value = solo.mode; $('if-cur').value = solo.price.currency || 'USD';
    if (editing) $('if-st').value = x.status === 'draft' ? 'draft' : 'live';
    function pr() { var p = $('if-solo').value === 'paid'; $('if-pr-w').hidden = !p; $('if-cur-w').hidden = !p; var n = $('if-paidnote'); if (n) n.hidden = !p; }
    $('if-solo').onchange = pr; pr();
    $('if-src').addEventListener('input', function () { if (editing) $('if-vn-w').hidden = !this.value.trim(); });
    ['if-desc', 'if-notes'].forEach(function (i) { $(i).addEventListener('input', function () { CH.warnIf(this); }); });
    $('if-tags').addEventListener('change', function (e) { if (document.querySelectorAll('#if-tags input:checked').length > 5) e.target.checked = false; });
    $('if-back').onclick = function () { sub = editing ? 'detail' : 'list'; draw(el); };
    $('if-test').onclick = function () { check($('if-src').value).then(function () {}); };
    $('if').addEventListener('submit', function (e) { e.preventDefault(); save(el, x); });
  }
  function showLine(src, line) {
    if (!line) return '';
    var l = String(src).split('\n')[line - 1];
    return l == null ? '' : '<pre class="cx-code-err stkc-scroll">' + line + ' | ' + E(l.slice(0, 200)) + '</pre>';
  }
  function check(src) {
    var out = $('if-chk'), err = $('if-err'); err.innerHTML = ''; out.textContent = '';
    if (!src.trim()) { err.textContent = 'Paste the Pine Script first.'; return Promise.resolve(false); }
    if (src.length > MAX_SRC) { err.textContent = 'The script is longer than 128 KB.'; return Promise.resolve(false); }
    if (!/^\s*\/\/\s*@version\s*=\s*[56]\b/m.test(src)) { err.textContent = 'Add //@version=5 or //@version=6 as the first line.'; return Promise.resolve(false); }
    var g = guardOk(src);
    if (g && g.ok === false) { err.innerHTML = E((g.line ? 'Line ' + g.line + ': ' : '') + g.msg) + showLine(src, g.line); return Promise.resolve(false); }
    out.textContent = 'Compiling on the chart engine…';
    return compile(src).then(function (r) {
      if (r.ok) { out.innerHTML = '<span class="cx-ok">Compiles and runs.</span> ' + r.plots + ' plot' + (r.plots === 1 ? '' : 's') + ' on 400 test bars.'; return true; }
      out.textContent = '';
      err.innerHTML = E((r.line ? 'Line ' + r.line + ': ' : '') + r.error) + showLine(src, r.line);
      return false;
    });
  }
  function uploadShots(iid, files) {
    return Promise.all(files.map(function (f, i) {
      var ref = firebase.storage().ref('communities/' + ctx.cid + '/shots/' + iid + '/s' + i + '-' + Date.now());
      return ref.put(f, { contentType: f.type }).then(function () { return ref.getDownloadURL(); });
    }));
  }
  function save(el, x) {
    var editing = !!x, err = $('if-err'); err.textContent = '';
    var name = $('if-name').value.trim(), src = $('if-src').value, newVer = !editing || !!src.trim();
    if (name.length < 2) return err.textContent = 'Name needs at least 2 characters.';
    if (!$('if-rules').checked) return err.textContent = 'Tick the Creator Rules box first.';
    if (CH.RISKY.test($('if-desc').value + ' ' + $('if-notes').value + ' ' + name)) return err.textContent = 'Remove wording like "guaranteed", "100%" or "risk-free". It breaks the Creator Rules.';
    var mode = $('if-solo').value, amt = mode === 'paid' ? Math.round(+$('if-amt').value) : 0;
    if (mode === 'paid' && !(amt >= 1 && amt <= 100000)) return err.textContent = 'Enter a price between 1 and 100000.';
    var planIds = [].slice.call(document.querySelectorAll('#if-plans input:checked')).map(function (i) { return i.value; });
    var files = [].slice.call($('if-shots').files || []);
    if (files.length > MAX_SHOTS) return err.textContent = 'Up to 4 screenshots.';
    if (files.some(function (f) { return !/^image\/(png|jpeg|webp)$/.test(f.type) || f.size > 5 * 1024 * 1024; })) return err.textContent = 'Screenshots must be PNG, JPG or WebP, up to 5 MB.';
    var btn = $('if-save'); btn.disabled = true;
    var iid = editing ? x.id : newId(), ver = editing ? (newVer ? x.version + 1 : x.version) : 1;
    var prot = $('if-prot').checked;
    (newVer ? check(src) : Promise.resolve(true)).then(function (ok) {
      if (!ok) throw { shown: true };
      return newVer ? loadMods() : null;
    }).then(function (m) {
      var built = null;
      if (m) {
        var O = m[0], S = m[1];
        var b = prot ? Object.assign({ kind: 'tpl' }, O.template(src)) : { kind: 'plain', source: O.rewrite(src, new Map()) };
        built = S.seal(CH.cfg.SEAL_PUB, JSON.stringify(b));
      }
      return Promise.all([built, files.length ? uploadShots(iid, files) : null]);
    }).then(function (r) {
      var sealed = r[0], shots = r[1] || (editing ? x.shots || [] : []);
      var doc = { ownerUid: ctx.cm.ownerUid, name: name, desc: $('if-desc').value.trim(), settingsNotes: $('if-notes').value.trim(),
        tags: [].slice.call(document.querySelectorAll('#if-tags input:checked')).map(function (i) { return i.value; }).slice(0, 5),
        shots: shots.slice(0, 4), protected: prot, planIds: planIds, solo: { mode: mode, price: { amount: amt, currency: $('if-cur').value } },
        version: ver, versionNotes: newVer ? ($('if-vn').value.trim() || (editing ? '' : 'First release')) : (x.versionNotes || ''),
        status: $('if-st').value, createdAt: editing ? x.createdAt : CH.ts(), updatedAt: CH.ts(), publishedAt: newVer ? CH.ts() : x.publishedAt,
        srcSize: newVer ? src.length : x.srcSize };
      var b = db.batch();
      if (newVer) {
        b.set(iref(iid).collection('src').doc('v' + ver), { version: ver, source: src, notes: doc.versionNotes, createdAt: CH.ts() });
        b.set(iref(iid).collection('vault').doc('v' + ver), { version: ver, sealed: sealed, createdAt: CH.ts() });
      }
      b.set(iref(iid), doc);
      return b.commit();
    }).then(function () {
      CH.toast('success', newVer ? (editing ? 'Published v' + ver + '. Members get it on their next chart load.' : 'Indicator published') : 'Saved');
      sub = 'list'; open = null; view(el, ctx);
    }).catch(function (e) {
      btn.disabled = false;
      if (e && e.shown) return;
      console.warn('TradeZoro: indicator save', e);
      err.textContent = e && e.code === 'permission-denied' ? 'Not allowed. Only the community owner can publish indicators.' : 'Could not save. Check the values and try again.';
    });
  }

  // ---------------------------------------------------------------- detail: access, codes, versions
  function detail(el, x) {
    var hd = holdersOf(x);
    var h = '<div class="cx-spread" style="margin-bottom:12px"><div><p class="cx-eyebrow">Indicator</p><h2 style="margin:0">' + E(x.name) + ' <span class="cx-chip">v' + x.version + '</span></h2></div>' +
      '<div class="cx-row"><button class="btn btn-ghost" id="id-back" type="button">All indicators</button><button class="btn btn-ghost" id="id-edit" type="button">Edit or new version</button>' +
      '<a class="btn btn-ghost" href="/charts?cind=' + E(ctx.cid) + '/' + E(x.id) + '">Open on ZoroCharts</a></div></div>' +
      '<div class="cx-stats"><div class="cx-box cx-stat"><b>' + hd.total + '</b>Holders</div><div class="cx-box cx-stat"><b>' + hd.plan + '</b>By plan</div><div class="cx-box cx-stat"><b>' + hd.solo + '</b>Given alone</div><div class="cx-box cx-stat"><b>' + (x._usage7 || 0) + '</b>Added to a chart, 7 days</div></div>' +
      '<div class="cx-box" style="margin-top:12px"><h3>Give access by email</h3><p class="cx-muted">They get it when they sign in with this verified email. Revoke any time; access also ends at the expiry date.</p>' +
      '<form id="ac-f" class="cx-row" novalidate><input id="ac-em" class="cx-in" type="email" placeholder="name@example.com" style="flex:2 1 220px"><input id="ac-exp" type="date" class="cx-in" aria-label="Access ends (optional)" style="flex:1 1 140px"><button class="btn btn-primary" type="submit">Give access</button></form><div id="ac-err" class="cx-bad" role="alert"></div>' +
      ((x._access || []).length ? '<div class="cx-tablewrap stkc-scroll" style="margin-top:12px;max-height:320px;overflow:auto"><table class="cx-table"><thead><tr><th>Email</th><th>How</th><th>Status</th><th>Expires</th><th></th></tr></thead><tbody>' +
        x._access.slice().sort(function (a, b) { return a.email.localeCompare(b.email); }).map(function (a) {
          var live = a.status === 'active' && (!a.expiresAt || a.expiresAt.toMillis() > Date.now());
          return '<tr data-e="' + E(a.id) + '"><td>' + E(a.email) + '</td><td>' + E({ manual: 'Added by you', invite: 'Invite code', free: 'Free claim' }[a.source] || a.source) + '</td><td><span class="cx-chip' + (live ? ' on' : '') + '">' + (a.status === 'revoked' ? 'Revoked' : live ? 'Active' : 'Expired') + '</span></td>' +
            '<td><input type="date" class="cx-in-s ac-exp" value="' + (a.expiresAt ? a.expiresAt.toDate().toISOString().slice(0, 10) : '') + '" aria-label="Expiry for ' + E(a.email) + '"></td>' +
            '<td class="cx-row"><button class="btn btn-ghost ac-sv" type="button">Save</button><button class="btn btn-ghost ac-tg" type="button">' + (a.status === 'revoked' ? 'Restore' : 'Revoke') + '</button></td></tr>';
        }).join('') + '</tbody></table></div>' : '<p class="cx-muted">Nobody has been given this indicator alone yet.</p>') + '</div>' +
      '<div class="cx-box" style="margin-top:12px"><h3>Invite codes for this indicator</h3><p class="cx-muted">Anyone with a code and a verified email gets the indicator (not the community).</p>' +
      '<form id="cd-f" class="cx-row" novalidate><input id="cd-max" class="cx-in" type="number" min="0" max="100000" value="0" aria-label="Max uses (0 = unlimited)" style="flex:1 1 110px"><input id="cd-days" class="cx-in" type="number" min="0" max="3650" value="0" aria-label="Access days (0 = no end)" style="flex:1 1 110px"><input id="cd-lbl" class="cx-in" type="text" maxlength="60" placeholder="Label (optional)" style="flex:2 1 160px"><button class="btn btn-primary" type="submit">Create code</button></form>' +
      '<div class="hint">Max uses 0 = unlimited. Access days 0 = no end.</div><div id="cd-list" class="cx-muted">Loading…</div></div>' +
      '<div class="cx-box" style="margin-top:12px"><h3>Version history</h3><div id="vh" class="cx-muted">Loading…</div></div>' +
      '<div class="cx-box" style="margin-top:12px"><h3>Remove</h3><p class="cx-muted">Deleting removes it from every member\'s chart on their next load.</p><button class="btn btn-ghost" id="id-del" type="button">Delete indicator</button></div>';
    el.innerHTML = h;
    $('id-back').onclick = function () { sub = 'list'; open = null; draw(el); };
    $('id-edit').onclick = function () { sub = 'form'; draw(el); };
    $('ac-f').onsubmit = function (e) {
      e.preventDefault(); var em = $('ac-em').value.trim().toLowerCase(), d = $('ac-exp').value, er = $('ac-err'); er.textContent = '';
      if (!/^[^\s@\/]+@[^\s@\/]+\.[^\s@\/]{2,}$/.test(em)) return er.textContent = 'Enter a valid email.';
      var exp = d ? new Date(d + 'T23:59:59Z') : null;
      if (exp && exp.getTime() < Date.now()) return er.textContent = 'The expiry date must be in the future.';
      var ref = iref(x.id).collection('access').doc(em);
      var have = (x._access || []).filter(function (a) { return a.id === em; })[0];
      (have ? ref.update({ status: 'active', expiresAt: CH.stamp(exp) }) : ref.set({ email: em, source: 'manual', status: 'active', expiresAt: CH.stamp(exp), createdBy: firebase.auth().currentUser.uid, createdAt: CH.ts() }))
        .then(function () { CH.toast('success', 'Access given to ' + em); reopen(el, x); }).catch(function () { er.textContent = 'Could not save. Try again.'; });
    };
    el.querySelectorAll('tr[data-e]').forEach(function (tr) {
      var em = tr.dataset.e, a = x._access.filter(function (z) { return z.id === em; })[0], ref = iref(x.id).collection('access').doc(em);
      tr.querySelector('.ac-sv').onclick = function () { var v = tr.querySelector('.ac-exp').value; ref.update({ expiresAt: v ? CH.stamp(new Date(v + 'T23:59:59Z')) : null }).then(function () { CH.toast('success', 'Saved'); reopen(el, x); }).catch(function () { CH.toast('error', 'Could not save.'); }); };
      tr.querySelector('.ac-tg').onclick = function () {
        if (a.status !== 'revoked' && !confirm('Revoke access for ' + em + '? It stops working on their next chart load.')) return;
        ref.update({ status: a.status === 'revoked' ? 'active' : 'revoked' }).then(function () { reopen(el, x); }).catch(function () { CH.toast('error', 'Could not save.'); });
      };
    });
    var codesCol = iref(x.id).collection('codes');
    function drawCodes() {
      codesCol.get().then(function (s) {
        var a = s.docs.map(function (d) { var o = d.data(); o.id = d.id; return o; });
        $('cd-list').innerHTML = a.length ? '<div class="cx-tablewrap stkc-scroll" style="margin-top:10px"><table class="cx-table"><tbody>' + a.map(function (c) {
          var link = 'https://tradezoro.com/c/' + ctx.cid + '?tab=indicators&ind=' + x.id + '&icode=' + c.id;
          return '<tr data-c="' + E(c.id) + '"><td><code>' + E(c.id) + '</code>' + (c.label ? ' <span class="cx-muted">' + E(c.label) + '</span>' : '') + '</td><td>' + c.uses + (c.maxUses ? ' / ' + c.maxUses : '') + ' used</td><td>' + (c.grantDays ? c.grantDays + ' days' : 'No end') + '</td><td>' + (c.status === 'active' ? 'Active' : 'Off') + '</td>' +
            '<td class="cx-row"><button class="btn btn-ghost cd-cp" type="button" data-l="' + E(link) + '">Copy link</button><button class="btn btn-ghost cd-tg" type="button">' + (c.status === 'active' ? 'Turn off' : 'Turn on') + '</button></td></tr>';
        }).join('') + '</tbody></table></div>' : 'No codes yet.';
        $('cd-list').querySelectorAll('.cd-cp').forEach(function (b) { b.onclick = function () { (navigator.clipboard ? navigator.clipboard.writeText(b.dataset.l) : Promise.reject()).then(function () { CH.toast('success', 'Copied'); }).catch(function () { prompt('Copy this link:', b.dataset.l); }); }; });
        $('cd-list').querySelectorAll('.cd-tg').forEach(function (b) { var id = b.closest('tr').dataset.c, c = a.filter(function (z) { return z.id === id; })[0]; b.onclick = function () { codesCol.doc(id).update({ status: c.status === 'active' ? 'off' : 'active' }).then(drawCodes).catch(function () { CH.toast('error', 'Could not save.'); }); }; });
      }).catch(function () { $('cd-list').textContent = 'Could not load codes.'; });
    }
    drawCodes();
    $('cd-f').onsubmit = function (e) {
      e.preventDefault();
      var d = { uses: 0, maxUses: Math.max(0, Math.min(100000, parseInt($('cd-max').value, 10) || 0)), expiresAt: null, grantDays: Math.max(0, Math.min(3650, parseInt($('cd-days').value, 10) || 0)), status: 'active', createdBy: firebase.auth().currentUser.uid, createdAt: CH.ts() };
      var l = $('cd-lbl').value.trim(); if (l) d.label = l.slice(0, 60);
      codesCol.doc(code()).set(d).then(function () { CH.toast('success', 'Code created'); drawCodes(); }).catch(function () { CH.toast('error', 'Could not create the code.'); });
    };
    iref(x.id).collection('src').get().then(function (s) {
      var v = s.docs.map(function (d) { return d.data(); }).sort(function (a, b) { return b.version - a.version; });
      $('vh').innerHTML = v.map(function (r) {
        return '<div class="cx-spread" style="padding:8px 0;border-bottom:1px solid var(--line-soft)"><div><b>v' + r.version + '</b>' + (r.version === x.version ? ' <span class="cx-chip on">Current</span>' : '') + ' <span class="cx-muted">' + E(CH.date(r.createdAt)) + ' · ' + Math.round(r.source.length / 1024 * 10) / 10 + ' KB</span>' + (r.notes ? '<div class="cx-muted">' + E(r.notes) + '</div>' : '') + '</div>' +
          '<button class="btn btn-ghost vh-dl" type="button" data-v="' + r.version + '">Download</button></div>';
      }).join('') || 'No versions.';
      $('vh').querySelectorAll('.vh-dl').forEach(function (b) { b.onclick = function () {
        var r = v.filter(function (z) { return z.version === +b.dataset.v; })[0];
        var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([r.source], { type: 'text/plain' })); a.download = x.name.replace(/[^\w-]+/g, '-') + '-v' + r.version + '.pine'; a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
      }; });
    }).catch(function () { $('vh').textContent = 'Could not load versions.'; });
    $('id-del').onclick = function () {
      if (!confirm('Delete "' + x.name + '"? Members lose it on their next chart load. This cannot be undone.')) return;
      iref(x.id).delete().then(function () { CH.toast('success', 'Deleted'); sub = 'list'; open = null; view(el, ctx); }).catch(function () { CH.toast('error', 'Could not delete.'); });
    };
  }
  function reopen(el, x) { view(el, ctx, x.id); }

  window.CHInd = { view: function (el, c) { sub = 'list'; open = null; view(el, c); } };
})();
