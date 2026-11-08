// Zscript Script Library: browse, script page, publish, versions, ratings, reports, buy (window.ZSLib).
// Depends on: firebase app/auth/firestore (+ storage for screenshots, + functions for Buy), assets/auth.js (`auth`),
//   assets/progress.js (`db`), assets/creator-config.js (SEAL_PUB), assets/creator-pay.js (CP: the payments switch + callable).
//   Optional: window.ZS.compileToBytecode(source) from the Zscript engine (assets/zs/), needed only to publish PROTECTED scripts.
// Used by: script-library.html (whole page, when #zl-root exists) and the Zscript editor (ZSLib.openPublish / ZSLib.get).
// Security: everything a member can do here is a Firestore write that the rules check ("ZSCRIPT SCRIPT LIBRARY" block in
// functions-src/firestore.rules). Paid access (zsScripts/{sid}/buyers/{uid}) is written ONLY by the creatorPay Cloud Function
// after Stripe confirms the payment; this file only starts checkout. Protected scripts: the source goes to src/ (author +
// admins only) and the compiled program is sealed to the server key before it leaves the author's browser (bin/).
(function (g) {
  var CFG = g.CREATOR_CONFIG || {};
  var CATS = [['trend', 'Trend'], ['momentum', 'Momentum'], ['volume', 'Volume'], ['order-flow', 'Order flow'], ['levels', 'Levels'],
    ['volatility', 'Volatility'], ['options', 'Options'], ['oscillator', 'Oscillator'], ['session', 'Session'], ['other', 'Other']];
  var DATA = [['book', 'Order book'], ['flow', 'Order flow'], ['gex', 'GEX+'], ['opt', 'ZoroOptions']];
  var REASONS = [['copied', 'Copied from someone else'], ['results', 'Promises profits or results'], ['malicious', 'Tries to do something harmful'],
    ['broken', 'Does not work'], ['abuse', 'Abusive or offensive'], ['other', 'Something else']];
  var MAX_SRC = 131072, MAX_PROG = 300000, PRICE_MIN = 1, PRICE_MAX = 999;
  var E = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var label = function (list, k) { for (var i = 0; i < list.length; i++) if (list[i][0] === k) return list[i][1]; return k; };
  var toast = function (t, m) { if (typeof showToast === 'function') showToast(t, m); else console.log(t, m); };
  var ts = function () { return firebase.firestore.FieldValue.serverTimestamp(); };
  var inc = function (n) { return firebase.firestore.FieldValue.increment(n); };
  var ms = function (t) { return typeof t === 'number' ? t : t && t.toMillis ? t.toMillis() : t && t.toDate ? +t.toDate() : 0; };
  var day = function (t) { var m = ms(t); return m ? new Date(m).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : ''; };
  var S = function (sid) { return db.collection('zsScripts').doc(sid); };
  var ICON = { x: '<path d="M6 6l12 12M18 6 6 18"/>', star: '<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9L12 3Z"/>',
    code: '<path d="m8 8-4 4 4 4M16 8l4 4-4 4M13.5 5l-3 14"/>', lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
    back: '<path d="M15 6l-6 6 6 6"/>', flag: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>' };
  var svg = function (n, s) { return '<svg width="' + (s || 20) + '" height="' + (s || 20) + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICON[n] + '</svg>'; };
  var user = function () { return new Promise(function (res) { if (typeof auth === 'undefined' || !auth) return res(null); var un = auth.onAuthStateChanged(function (u) { un(); res(u); }); }); };
  var signIn = function () { if (typeof goToLoginPreservingReturn === 'function') goToLoginPreservingReturn(); else location.href = '/login'; };
  var RISKY = /guarantee|100\s?%|risk[- ]?free|profit every|can'?t lose|no risk|sure win|win rate|\d+\s?% (?:return|profit|accuracy)/i;

  var ZSLib = { CATS: CATS, DATA: DATA };

  // ---- pure helpers (tested in tools/tests/zs-library.test.js) ------------------------------------------------------------
  // Which of our data namespaces a script reads (comments and strings removed first, so a mention in a comment does not count).
  ZSLib.dataUsed = function (src) {
    var code = String(src || '').replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ').replace(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/g, '""');
    return DATA.map(function (d) { return d[0]; }).filter(function (k) { return new RegExp('(^|[^A-Za-z0-9_.])' + k + '\\.[A-Za-z_]').test(code); });
  };
  ZSLib.isZscript = function (src) { var l = String(src || '').split('\n').filter(function (x) { return x.trim(); })[0] || ''; return /^\s*\/\/@zscript\s+1\b/.test(l); };
  ZSLib.price = function (sale) { var a = +(sale && sale.price && sale.price.amount) || 0; return '$' + (a % 1 ? a.toFixed(2) : a); };
  ZSLib.stars = function (sum, count) { return count > 0 ? Math.round((sum / count) * 10) / 10 : null; };
  // The library list: filter + sort, no network. f = { q, cat, data, sale:'all'|'free'|'paid', sort:'new'|'added'|'rated' }
  ZSLib.filter = function (list, f) {
    var q = String(f.q || '').trim().toLowerCase();
    var out = list.filter(function (s) {
      return (!f.cat || s.category === f.cat) && (!f.data || (s.dataUsed || []).indexOf(f.data) >= 0)
        && (!f.sale || f.sale === 'all' || (s.sale && s.sale.mode) === f.sale)
        && (!q || (s.name + ' ' + (s.desc || '') + ' ' + (s.authorName || '')).toLowerCase().indexOf(q) >= 0);
    });
    var by = f.sort === 'added' ? function (a, b) { return (b.addCount || 0) - (a.addCount || 0) || ms(b.publishedAt) - ms(a.publishedAt); }
      : f.sort === 'rated' ? function (a, b) { return (ZSLib.stars(b.ratingSum, b.ratingCount) || 0) - (ZSLib.stars(a.ratingSum, a.ratingCount) || 0) || (b.ratingCount || 0) - (a.ratingCount || 0); }
      : function (a, b) { return ms(b.updatedAt || b.publishedAt) - ms(a.updatedAt || a.publishedAt); };
    return out.sort(by);
  };
  // Publish form -> checked values or { error }. o = { name, desc, category, access, mode, amount, notes, source, payoutsActive }
  ZSLib.validate = function (o) {
    var name = String(o.name || '').trim(), desc = String(o.desc || '').trim(), src = String(o.source || '');
    if (name.length < 3 || name.length > 60) return { error: 'Give the script a name of 3 to 60 characters.' };
    if (desc.length > 4000) return { error: 'Keep the description under 4,000 characters.' };
    if (!label(CATS, o.category) || CATS.every(function (c) { return c[0] !== o.category; })) return { error: 'Pick a category.' };
    if (!src.trim()) return { error: 'The script is empty.' };
    if (src.length > MAX_SRC) return { error: 'Scripts can be up to 128 KB.' };
    if (!ZSLib.isZscript(src)) return { error: 'The first line must be //@zscript 1.' };
    if (RISKY.test(name + ' ' + desc + ' ' + (o.notes || ''))) return { error: 'Do not promise results, profits or win rates. Describe what the script draws.' };
    if (['open', 'protected'].indexOf(o.access) < 0) return { error: 'Choose open-source or protected.' };
    var amount = 0;
    if (o.mode === 'paid') {
      if (!o.payoutsActive) return { error: 'Set up payouts in Creator Hub before selling a script.' };
      amount = Math.round(Number(o.amount) * 100) / 100;
      if (!(amount >= PRICE_MIN && amount <= PRICE_MAX)) return { error: 'Set a price from $1 to $999.' };
    } else if (o.mode !== 'free') return { error: 'Choose free or paid.' };
    return { name: name, desc: desc, category: o.category, access: o.access, sale: { mode: o.mode, price: { amount: amount, currency: 'USD' } },
      notes: String(o.notes || '').trim().slice(0, 1000), source: src, dataUsed: ZSLib.dataUsed(src) };
  };

  // ---- shared bits ----------------------------------------------------------------------------------------------------------
  function sheet(title, html) {
    var bg = document.createElement('div'); bg.className = 'cx-sheet-bg';
    bg.innerHTML = '<div class="cx-sheet" role="dialog" aria-modal="true" aria-label="' + E(title) + '"><div class="cx-grab" aria-hidden="true"></div><div class="cx-sheet-h"><h2>' + E(title) +
      '</h2><button type="button" class="cx-x" aria-label="Close">' + svg('x') + '</button></div><div class="cx-sheet-b stkc-scroll">' + html + '</div></div>';
    document.body.appendChild(bg); document.body.classList.add('cx-noscroll');
    var prev = document.activeElement;
    function close() { document.removeEventListener('keydown', key); bg.remove(); document.body.classList.remove('cx-noscroll'); if (prev && prev.focus) try { prev.focus(); } catch (e) {} }
    function key(e) { if (e.key === 'Escape') close(); }
    document.addEventListener('keydown', key);
    bg.querySelector('.cx-x').onclick = close;
    bg.addEventListener('mousedown', function (e) { if (e.target === bg) close(); });
    return { el: bg, body: bg.querySelector('.cx-sheet-b'), close: close, $: function (id) { return bg.querySelector('#' + id); } };
  }
  function busy(b, t) { b.disabled = true; b.dataset.l = b.textContent; b.textContent = t; }
  function unbusy(b) { b.disabled = false; b.textContent = b.dataset.l || b.textContent; }
  var profName = function (u) {
    return db.collection('profiles').doc(u.uid).get().then(function (p) { var n = p.exists ? String(p.data().displayName || '').trim() : ''; return n && n.length <= 60 ? n : 'Member'; }).catch(function () { return 'Member'; });
  };
  var payoutsActive = function (u) {
    return db.collection('creatorAccounts').doc(u.uid).get().then(function (s) { return s.exists && s.data().status === 'active'; }).catch(function () { return false; });
  };
  var sealMod = null;
  // The sealed build names its script, author and version; the server refuses it anywhere else (no copying a bin into another script).
  function sealProgram(program, bind) {
    if (!CFG.SEAL_PUB) return Promise.reject(new Error('Protected publishing is not set up on this page.'));
    if (!sealMod) sealMod = import('/assets/creator-seal.js?v=920');
    return sealMod.then(function (m) { return m.seal(CFG.SEAL_PUB, JSON.stringify({ kind: 'zsbin', sid: bind.sid, authorUid: bind.authorUid, v: bind.v, program: program })); });
  }
  // The engine's compile-to-program (S1). Protected publishing needs it; open-source publishing does not.
  // SPEC 11.1: import { compile } from '/assets/zs/index.js' -> { ok, diagnostics, program, meta }. Pure, no side effects.
  var engine = null;
  function compile(source) {
    if (!engine) engine = g.ZS && typeof g.ZS.compile === 'function' ? Promise.resolve(g.ZS)
      : import('/assets/zs/index.js?v=920').catch(function () { engine = null; return null; });
    return engine.then(function (Z) {
      if (!Z || typeof Z.compile !== 'function') throw new Error('Protected publishing needs the Zscript engine. Publish from the editor, or choose open-source.');
      return Z.compile(source);
    }).then(function (r) {
      if (!r || !r.ok) { var d = r && r.diagnostics && r.diagnostics[0]; throw new Error(d ? 'Line ' + d.line + ':' + d.col + ': ' + d.message : 'The script does not compile.'); }
      var text = JSON.stringify(r.program);
      if (text.length > MAX_PROG) throw new Error('The compiled script is too big to publish protected (over 300 KB).');
      return r.program;
    });
  }
  function uploadShots(u, sid, files) {
    if (!files.length) return Promise.resolve(null);
    if (!firebase.storage) return Promise.reject(new Error('Screenshots cannot be uploaded on this page.'));
    return Promise.all(files.map(function (f, i) {
      var ref = firebase.storage().ref('zsShots/' + u.uid + '/' + sid + '/s' + i + '-' + Date.now());
      return ref.put(f, { contentType: f.type }).then(function () { return ref.getDownloadURL(); });
    }));
  }
  function shotFiles(input) {
    var files = [].slice.call((input && input.files) || []);
    if (files.length > 4) throw new Error('Up to 4 screenshots.');
    if (files.some(function (f) { return !/^image\/(png|jpeg|webp)$/.test(f.type) || f.size >= 5 * 1024 * 1024; })) throw new Error('Screenshots must be PNG, JPG or WebP, under 5 MB.');
    return files;
  }
  // The batch writes for a version: src + versions (+ sealed bin for protected). The parent doc goes in the same batch.
  function versionWrites(b, sid, n, v, sealed) {
    b.set(S(sid).collection('src').doc('v' + n), { version: n, source: v.source, createdAt: ts() });
    b.set(S(sid).collection('versions').doc('v' + n), { version: n, notes: v.notes, createdAt: ts() });
    if (sealed) b.set(S(sid).collection('bin').doc('v' + n), { version: n, sealed: sealed, createdAt: ts() });
  }

  // ---- publish (new script, or a new version of one of mine) --------------------------------------------------------------
  // opts = { source, title?, existing?: {sid, ...doc} }  -> Promise<sid|null>
  ZSLib.openPublish = function (opts) {
    opts = opts || {};
    var ex = opts.existing || null;
    return user().then(function (u) {
      if (!u) { signIn(); return null; }
      return Promise.all([payoutsActive(u), profName(u)]).then(function (r) { return form(u, r[0], r[1]); });
    });
    function form(u, pay, pname) {
      var x = ex || { name: opts.title || '', desc: '', category: 'trend', access: 'open', sale: { mode: 'free', price: { amount: 0 } } };
      var cats = CATS.map(function (c) { return '<option value="' + c[0] + '"' + (c[0] === x.category ? ' selected' : '') + '>' + c[1] + '</option>'; }).join('');
      var seg = function (id, name, opts2, cur) {
        return '<div class="cx-seg" role="radiogroup" id="' + id + '">' + opts2.map(function (o) { return '<button type="button" role="radio" data-v="' + o[0] + '" aria-checked="' + (o[0] === cur) + '" class="' + (o[0] === cur ? 'on' : '') + '"' + (o[2] ? ' disabled' : '') + '>' + o[1] + '</button>'; }).join('') + '</div>';
      };
      var html = '<form class="cx-f zl-pub" novalidate>' +
        (ex ? '<p class="cx-muted">New version of <b>' + E(ex.name) + '</b> (now v' + ex.version + '). Members get it the next time their chart loads it.</p>' : '') +
        '<div><label for="zp-name">Name</label><input id="zp-name" type="text" maxlength="60" value="' + E(x.name) + '" autocomplete="off"></div>' +
        '<div><label for="zp-desc">Description</label><textarea id="zp-desc" maxlength="4000" placeholder="What it draws and how to read it. Describe the tool, not results.">' + E(x.desc) + '</textarea></div>' +
        '<div><label for="zp-cat">Category</label><select id="zp-cat">' + cats + '</select></div>' +
        '<div><label id="zp-acc-l">Source code</label>' + seg('zp-acc', 'access', [['open', 'Open-source'], ['protected', 'Protected']], x.access) +
        '<div class="hint" id="zp-acc-h"></div></div>' +
        '<div><label id="zp-mode-l">Price</label>' + seg('zp-mode', 'mode', [['free', 'Free'], ['paid', 'Paid', !pay]], x.sale.mode === 'paid' && pay ? 'paid' : 'free') +
        '<div class="hint" id="zp-mode-h">' + (pay ? '' : 'To sell scripts, <a href="/creator">set up payouts in Creator Hub</a> first.') + '</div></div>' +
        '<div id="zp-price-w" hidden><label for="zp-price">Price in US dollars (one-time)</label><input id="zp-price" type="number" inputmode="decimal" min="1" max="999" step="0.01" value="' + (x.sale.mode === 'paid' ? E(x.sale.price.amount) : '') + '">' +
        '<div class="hint">You set the price. It shows on the script page only. Stripe\'s fees apply; buyers pay you through your Creator Hub payout account.</div></div>' +
        (opts.source ? '' : '<div><label for="zp-src">Script</label><textarea id="zp-src" class="zl-code" spellcheck="false" placeholder="//@zscript 1&#10;indicator(&quot;My script&quot;)"></textarea></div>') +
        '<div><label for="zp-notes">' + (ex ? 'What changed' : 'Version notes') + '</label><input id="zp-notes" type="text" maxlength="1000" placeholder="' + (ex ? 'e.g. Faster on long charts' : 'First version') + '"></div>' +
        '<div><label for="zp-shots">Screenshots (up to 4, PNG/JPG/WebP)</label><input id="zp-shots" type="file" accept="image/png,image/jpeg,image/webp" multiple>' + (ex && (ex.shots || []).length ? '<div class="hint">Choosing new files replaces the current ones.</div>' : '') + '</div>' +
        '<p class="hint">Published as ' + E(pname) + '. Change your name on your profile. Scripts are for education only, not financial advice; no claims about results.</p>' +
        '<p class="cx-bad" id="zp-err" role="alert"></p>' +
        '<div class="cx-actions"><button type="submit" class="btn btn-primary" id="zp-go">' + (ex ? 'Publish v' + (ex.version + 1) : 'Publish') + '</button></div></form>';
      var sh = sheet(ex ? 'Publish a new version' : 'Publish to the library', html);
      var st = { access: x.access, mode: x.sale.mode === 'paid' && pay ? 'paid' : 'free' };
      function paint() {
        sh.$('zp-acc-h').textContent = st.access === 'open' ? 'Anyone who can run it can read and copy the code.' : 'Members run it without seeing the code. Hidden, not unbreakable.';
        sh.$('zp-price-w').hidden = st.mode !== 'paid';
        ['zp-acc', 'zp-mode'].forEach(function (id) { sh.$(id).querySelectorAll('button').forEach(function (b) { var on = b.dataset.v === st[id === 'zp-acc' ? 'access' : 'mode']; b.classList.toggle('on', on); b.setAttribute('aria-checked', on); }); });
      }
      sh.$('zp-acc').onclick = function (e) { var b = e.target.closest('button'); if (b && !b.disabled) { st.access = b.dataset.v; paint(); } };
      sh.$('zp-mode').onclick = function (e) { var b = e.target.closest('button'); if (b && !b.disabled) { st.mode = b.dataset.v; paint(); } };
      paint();
      setTimeout(function () { try { sh.$('zp-name').focus(); } catch (e) {} }, 60);
      var done = null, p = new Promise(function (r) { done = r; });
      sh.el.querySelector('form').onsubmit = function (e) {
        e.preventDefault();
        var err = sh.$('zp-err'), go = sh.$('zp-go'); err.textContent = '';
        var v = ZSLib.validate({ name: sh.$('zp-name').value, desc: sh.$('zp-desc').value, category: sh.$('zp-cat').value, access: st.access, mode: st.mode,
          amount: sh.$('zp-price').value, notes: sh.$('zp-notes').value, source: opts.source || (sh.$('zp-src') && sh.$('zp-src').value), payoutsActive: pay });
        if (v.error) { err.textContent = v.error; return; }
        var files; try { files = shotFiles(sh.$('zp-shots')); } catch (x2) { err.textContent = x2.message; return; }
        busy(go, 'Publishing…');
        var sid = ex ? ex.sid : db.collection('zsScripts').doc().id;
        var n = ex ? ex.version + 1 : 1;
        var sealedP = v.access === 'protected' ? (opts.program ? Promise.resolve(opts.program) : compile(v.source)).then(function (pg) { return sealProgram(pg, { sid: sid, authorUid: u.uid, v: n }); }) : Promise.resolve(null);
        Promise.all([sealedP, uploadShots(u, sid, files)]).then(function (r) {
          var shots = r[1] || (ex ? ex.shots || [] : []);
          var doc = { authorUid: u.uid, authorName: pname, name: v.name, desc: v.desc, category: v.category, dataUsed: v.dataUsed, access: v.access, sale: v.sale,
            shots: shots.slice(0, 4), version: n, versionNotes: v.notes, status: ex && ex.status === 'unlisted' ? 'unlisted' : 'live', srcSize: v.source.length,
            ratingSum: ex ? ex.ratingSum : 0, ratingCount: ex ? ex.ratingCount : 0, addCount: ex ? ex.addCount : 0, modNote: ex ? ex.modNote || '' : '',
            createdAt: ex ? ex.createdAt : ts(), updatedAt: ts(), publishedAt: ts() };
          var b = db.batch();
          b.set(S(sid), doc);
          versionWrites(b, sid, n, v, r[0]);
          return b.commit();
        }).then(function () {
          toast('success', ex ? 'Version ' + n + ' published.' : 'Published to the library.');
          sh.close(); done(sid);
          if (opts.onDone) opts.onDone(sid);
        }).catch(function (x3) { unbusy(go); err.textContent = /permission/i.test(x3 && x3.message) ? 'Could not publish. Check the fields and try again.' : (x3 && x3.message) || 'Could not publish.'; });
      };
      return p;
    }
  };

  // ---- delivery to a chart (editor / chart code calls this) ---------------------------------------------------------------
  // -> { sid, name, version, access, source? , sealed? }   rejects { code, message }
  ZSLib.get = function (sid, workerPub) {
    return user().then(function (u) {
      if (!u) throw { code: 'signin', message: 'Sign in to add library scripts.' };
      return u.getIdToken().then(function (t) {
        return fetch('/api/zs/get', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + t }, body: JSON.stringify({ sid: sid, pub: workerPub || undefined }) });
      }).then(function (r) {
        if ((r.headers.get('content-type') || '').indexOf('json') < 0) return direct(sid);   // no Pages Functions (local dev): read with the rules
        return r.json().then(function (d) { if (!r.ok || !d.ok) throw { code: d.error || 'server', message: d.message || 'Could not load the script.' }; return d; });
      });
    });
    function direct(sid2) {
      return S(sid2).get().then(function (s) {
        if (!s.exists) throw { code: 'gone', message: 'This script is not available.' };
        var m = s.data();
        if (m.access !== 'open') throw { code: 'noaccess', message: 'Protected scripts load through the site only.' };
        return S(sid2).collection('src').doc('v' + m.version).get().then(function (x) { return { sid: sid2, name: m.name, version: m.version, access: 'open', source: x.data().source }; });
      }).catch(function (e) { throw e && e.code && e.message ? e : { code: 'noaccess', message: 'You cannot run this script.' }; });
    }
  };

  // Count an add (once per member) and open the chart with it.
  ZSLib.addToChart = function (sid, u) {
    var go = function () { location.href = '/charts?zs=' + encodeURIComponent(sid); };
    var m = S(sid).collection('adds').doc(u.uid);
    return m.get().then(function (s) {
      if (s.exists) return go();
      var b = db.batch(); b.set(m, { uid: u.uid, createdAt: ts() }); b.update(S(sid), { addCount: inc(1) });
      return b.commit().then(go, go);
    }).catch(go);
  };

  // ---- the page (script-library.html) -------------------------------------------------------------------------------------
  // Hidden until launch (assets/zs-config.js ZS_LAUNCHED; ?zs=1 opens a preview for this tab).
  function gated() {
    var root = document.getElementById('zl-root'); if (!root) return;
    import('/assets/zs-config.js?v=920').then(function (c) { return c.zsEnabled(); }, function () { return false; }).then(function (on) {
      if (on) return page();
      root.innerHTML = '<div class="cx-empty"><h1>Script Library</h1><p class="cx-muted">The Script Library is not open yet.</p><a class="btn btn-primary" href="/charts">Open charts</a></div>';
    });
  }
  function page() {
    var root = document.getElementById('zl-root'); if (!root) return;
    var me = null, all = [], loaded = false, f = { q: '', cat: '', data: '', sale: 'all', sort: 'new' }, pager = null;
    var $ = function (id) { return document.getElementById(id); };
    function route() { var s = new URLSearchParams(location.search).get('s'); if (s && /^[A-Za-z0-9]{20}$/.test(s)) script(s); else list(); }
    window.addEventListener('popstate', route);
    function nav(sid) { history.pushState(null, '', location.pathname + (sid ? '?s=' + sid : '')); route(); window.scrollTo(0, 0); }

    // -- list
    function list() {
      document.title = 'Script Library | TradeZoro';
      var chips = function (id, items, cur, all1) { return '<div class="zl-chips" id="' + id + '" role="group">' + [['', all1]].concat(items).map(function (c) { return '<button type="button" class="cx-chip' + (c[0] === cur ? ' on' : '') + '" data-v="' + c[0] + '" aria-pressed="' + (c[0] === cur) + '">' + c[1] + '</button>'; }).join('') + '</div>'; };
      root.innerHTML = '<div class="zl-head"><div><h1>Script Library</h1><p class="cx-muted">Zscript indicators shared by members. Add one to your chart in a tap. Education only. Not financial advice.</p></div>' +
        '<button type="button" class="btn btn-primary" id="zl-pub">Publish a script</button></div>' +
        '<div class="cx-search"><input class="cx-in" id="zl-q" type="search" placeholder="Search scripts or authors" aria-label="Search scripts" value="' + E(f.q) + '">' +
        '<select class="cx-in-s" id="zl-sort" aria-label="Sort"><option value="new">Newest</option><option value="added">Most added</option><option value="rated">Top rated</option></select></div>' +
        '<div class="cx-seg zl-sale" id="zl-sale" role="radiogroup" aria-label="Price">' + [['all', 'All'], ['free', 'Free'], ['paid', 'Paid']].map(function (o) { return '<button type="button" role="radio" data-v="' + o[0] + '" class="' + (f.sale === o[0] ? 'on' : '') + '" aria-checked="' + (f.sale === o[0]) + '">' + o[1] + '</button>'; }).join('') + '</div>' +
        chips('zl-cats', CATS, f.cat, 'All categories') + chips('zl-data', DATA, f.data, 'Any data') +
        '<div class="zl-grid" id="zl-grid"></div><div class="cx-empty" id="zl-empty" hidden></div>';
      $('zl-sort').value = f.sort; pager = null;
      $('zl-q').oninput = function () { f.q = this.value; render(); };
      $('zl-sort').onchange = function () { f.sort = this.value; render(); };
      var pick = function (id, key) { $(id).onclick = function (e) { var b = e.target.closest('button'); if (!b) return; f[key] = b.dataset.v; $(id).querySelectorAll('button').forEach(function (x) { var on = x === b; x.classList.toggle('on', on); x.setAttribute(x.getAttribute('role') === 'radio' ? 'aria-checked' : 'aria-pressed', on); }); render(); }; };
      pick('zl-sale', 'sale'); pick('zl-cats', 'cat'); pick('zl-data', 'data');
      $('zl-pub').onclick = function () { ZSLib.openPublish({ onDone: function (sid) { reload().then(function () { nav(sid); }); } }); };
      render();
    }
    function card(s) {
      var r = ZSLib.stars(s.ratingSum, s.ratingCount);
      var shot = (s.shots || [])[0];
      return '<a class="zl-card" href="?s=' + E(s.id) + '" data-sid="' + E(s.id) + '">' +
        '<div class="zl-shot' + (shot ? '' : ' none') + '">' + (shot ? '<img src="' + E(shot) + '" alt="" loading="lazy">' : svg('code', 28)) + '</div>' +
        '<div class="zl-cb"><h3>' + E(s.name) + '</h3><p class="zl-by">by ' + E(s.authorName) + '</p>' +
        '<p class="zl-desc">' + E((s.desc || '').slice(0, 200)) + '</p>' +
        '<div class="zl-tags"><span class="cx-chip">' + E(label(CATS, s.category)) + '</span>' + (s.dataUsed || []).map(function (d) { return '<span class="cx-chip zl-data">' + E(label(DATA, d)) + ' data</span>'; }).join('') + '</div>' +
        '<div class="zl-meta"><span class="zl-badge ' + (s.sale && s.sale.mode === 'paid' ? 'paid' : 'free') + '">' + (s.sale && s.sale.mode === 'paid' ? 'Paid' : 'Free') + '</span>' +
        (s.access === 'protected' ? '<span class="zl-lock">' + svg('lock', 14) + 'Protected</span>' : '<span class="zl-lock">' + svg('code', 14) + 'Open-source</span>') +
        '<span class="zl-r">' + (r ? svg('star', 14) + r.toFixed(1) + ' (' + s.ratingCount + ')' : 'No ratings yet') + '</span></div></div></a>';
    }
    function render() {
      var grid = $('zl-grid'); if (!grid) return;
      if (!loaded) { grid.innerHTML = '<div data-skel="cards" data-n="3"></div>'; return; }
      var out = ZSLib.filter(all, f), total = out.length;
      if (!pager && window.StrykerPager) pager = StrykerPager.create({ after: grid, label: 'scripts', sizes: [24, 48, 96], size: 24, scrollTo: '#zl-grid', onChange: render });
      if (pager) { pager.setTotal(total); out = pager.slice(out); }
      grid.innerHTML = out.map(card).join('');
      grid.onclick = function (e) { var a = e.target.closest('a[data-sid]'); if (!a || e.metaKey || e.ctrlKey) return; e.preventDefault(); nav(a.dataset.sid); };
      var em = $('zl-empty'); em.hidden = total > 0;
      if (!total) em.textContent = all.length ? 'No scripts match. Try a different search or filter.' : 'No scripts yet. Be the first to publish one.';
    }
    function reload() {
      return db.collection('zsScripts').where('status', '==', 'live').limit(500).get().then(function (s) {
        all = s.docs.map(function (d) { var o = d.data(); o.id = d.id; return o; }); loaded = true; render();
      }).catch(function () { loaded = true; all = []; render(); var em = $('zl-empty'); if (em) { em.hidden = false; em.textContent = 'Could not load the library. Check your connection and try again.'; } });
    }

    // -- script page
    function script(sid) {
      root.innerHTML = '<div data-skel="cards" data-n="1"></div>';
      var ref = S(sid);
      Promise.all([ref.get(), me ? ref.collection('buyers').doc(me.uid).get().catch(function () { return null; }) : null,
        me ? ref.collection('adds').doc(me.uid).get().catch(function () { return null; }) : null,
        me ? db.collection('admins').doc(me.uid).get().then(function (a) { return a.exists; }).catch(function () { return false; }) : false,
        g.CP ? CP.open(me) : false]).then(function (r) {
        if (!r[0].exists) { root.innerHTML = back() + '<div class="cx-empty">This script is not available.</div>'; bindBack(); return; }
        var s = r[0].data(); s.sid = sid;
        var mine = !!me && s.authorUid === me.uid, owned = !!(r[1] && r[1].exists && r[1].data().status === 'active'), added = !!(r[2] && r[2].exists), isAdm = r[3], payOpen = r[4];
        var paid = s.sale && s.sale.mode === 'paid', canRun = mine || !paid || owned;
        document.title = s.name + ' | Script Library | TradeZoro';
        var rv = ZSLib.stars(s.ratingSum, s.ratingCount);
        var cta;
        if (s.status === 'removed') cta = '<p class="cx-bad">This script was taken down by TradeZoro' + (s.modNote ? ': ' + E(s.modNote) : '.') + '</p>';
        else if (canRun) cta = '<button type="button" class="btn btn-primary" id="zs-add">Add to chart</button>';
        else if (payOpen) cta = '<button type="button" class="btn btn-primary" id="zs-buy">Buy · ' + E(ZSLib.price(s.sale)) + ' one-time</button>';
        else cta = '<button type="button" class="btn btn-primary" disabled>' + E(ZSLib.price(s.sale)) + ' · Paid checkout opens soon</button>';
        var shots = (s.shots || []).length ? '<div class="zs-shots stkc-scroll">' + s.shots.map(function (u2) { return '<img src="' + E(u2) + '" alt="Screenshot of ' + E(s.name) + '" loading="lazy">'; }).join('') + '</div>' : '';
        root.innerHTML = back() +
          '<article class="zs-page"><div class="zs-main">' + shots +
          '<h1>' + E(s.name) + '</h1><p class="zl-by">by ' + E(s.authorName) + ' · v' + s.version + ' · updated ' + E(day(s.updatedAt)) + (s.status === 'unlisted' ? ' · <span class="cp-amber">Unlisted</span>' : '') + '</p>' +
          '<div class="zl-tags"><span class="cx-chip">' + E(label(CATS, s.category)) + '</span>' + (s.dataUsed || []).map(function (d) { return '<span class="cx-chip zl-data">' + E(label(DATA, d)) + ' data</span>'; }).join('') + '</div>' +
          '<div class="zs-desc">' + (s.desc ? E(s.desc).split(/\n{2,}/).map(function (p2) { return '<p>' + p2.replace(/\n/g, '<br>') + '</p>'; }).join('') : '<p class="cx-muted">No description.</p>') + '</div>' +
          ((s.dataUsed || []).length ? '<p class="hint zs-note">Uses ' + s.dataUsed.map(function (d) { return label(DATA, d); }).join(', ') + ' data. It shows only the data your plan includes, the same as your charts.</p>' : '') +
          '<section class="zs-sec"><h2>Version history</h2><ol class="zs-vers" id="zs-vers"><li class="cx-muted">Loading…</li></ol></section>' +
          '<section class="zs-sec"><div class="cx-spread"><h2>Ratings</h2><span id="zs-rate-w"></span></div><div id="zs-ratings"><p class="cx-muted">Loading…</p></div></section>' +
          '</div><aside class="zs-side"><div class="cx-box">' +
          '<div class="zs-rv">' + (rv ? svg('star', 18) + '<b>' + rv.toFixed(1) + '</b><span class="cx-muted">' + s.ratingCount + ' rating' + (s.ratingCount === 1 ? '' : 's') + '</span>' : '<span class="cx-muted">No ratings yet</span>') + '</div>' +
          '<p class="cx-muted">' + (s.access === 'protected' ? svg('lock', 14) + ' Protected: runs on your chart, the code stays hidden.' : svg('code', 14) + ' Open-source: you can read the code.') + '</p>' +
          (owned && !mine ? '<p class="cx-ok">You own this script.</p>' : '') + cta +
          (s.access === 'open' && canRun && s.status !== 'removed' ? '<button type="button" class="btn btn-ghost" id="zs-src">View code</button>' : '') +
          (mine && s.status !== 'removed' ? '<div class="zs-own"><button type="button" class="btn btn-secondary" id="zs-ver">Publish new version</button><button type="button" class="btn btn-ghost" id="zs-vis">' + (s.status === 'unlisted' ? 'List in library' : 'Unlist') + '</button></div>' : '') +
          (paid ? '<p class="cp-foot">Sold by ' + E(s.authorName) + ', an independent creator. ' + E(g.CP ? CP.platformLine() : '') + ' Refunds: ask the author first.</p>' : '') +
          (me && !mine ? '<button type="button" class="zs-report" id="zs-rep">' + svg('flag', 16) + 'Report this script</button>' : '') +
          '<p class="hint">Education only. Not financial advice.</p></div></aside></article>';
        bindBack();
        var add = $('zs-add'); if (add) add.onclick = function () { if (!me) return signIn(); busy(add, 'Opening chart…'); ZSLib.addToChart(sid, me); };
        var buy = $('zs-buy'); if (buy) buy.onclick = function () {
          if (!me) return signIn();
          busy(buy, 'Opening Stripe…');
          CP.call('zsCheckout', { sid: sid }).then(function (x) { location.href = x.url; }).catch(function (x) { unbusy(buy); toast('error', CP.errText(x)); });
        };
        var src = $('zs-src'); if (src) src.onclick = function () {
          ref.collection('src').doc('v' + s.version).get().then(function (x) { var sh = sheet(s.name + ' · v' + s.version, '<pre class="zl-code zs-pre">' + E(x.data().source) + '</pre>'); sh.body.querySelector('pre').focus && 0; })
            .catch(function () { toast('error', 'Could not load the code.'); });
        };
        var ver = $('zs-ver'); if (ver) ver.onclick = function () { ZSLib.openPublish({ existing: s, onDone: function () { script(sid); } }); };
        var vis = $('zs-vis'); if (vis) vis.onclick = function () {
          busy(vis, 'Saving…');
          var d = {}; for (var k in s) if (k !== 'sid') d[k] = s[k];
          d.status = s.status === 'unlisted' ? 'live' : 'unlisted'; d.updatedAt = ts();
          ref.set(d).then(function () { reload(); script(sid); }).catch(function () { unbusy(vis); toast('error', 'Could not save.'); });
        };
        var rep = $('zs-rep'); if (rep) rep.onclick = function () { report(sid); };
        versions(ref);
        ratings(ref, s, { mine: mine, owned: owned, added: added, paid: paid, isAdm: isAdm });
        // Back from Stripe: the webhook writes the purchase a moment later.
        if (/[?&]paid=1/.test(location.search) && me && !owned) waitBuyer(sid);
      }).catch(function () { root.innerHTML = back() + '<div class="cx-empty">Could not load this script. Check your connection and try again.</div>'; bindBack(); });
    }
    function back() { return '<a class="zs-back" href="' + location.pathname + '" id="zs-back">' + svg('back', 18) + 'Script Library</a>'; }
    function bindBack() { var b = $('zs-back'); if (b) b.onclick = function (e) { e.preventDefault(); nav(null); }; }
    function waitBuyer(sid) {
      var n = 0;
      (function tick() {
        S(sid).collection('buyers').doc(me.uid).get().then(function (b) {
          if (b.exists && b.data().status === 'active') { toast('success', 'Purchase confirmed. Add it to your chart.'); history.replaceState(null, '', location.pathname + '?s=' + sid); return script(sid); }
          if (++n < 20) setTimeout(tick, 1500); else toast('info', 'Payment received. Access appears in a minute; reload the page.');
        }).catch(function () { if (++n < 20) setTimeout(tick, 1500); });
      })();
    }
    function versions(ref) {
      ref.collection('versions').get().then(function (q) {
        var v = q.docs.map(function (d) { return d.data(); }).sort(function (a, b) { return b.version - a.version; });
        var el = $('zs-vers'); if (!el) return;
        el.innerHTML = v.length ? v.map(function (x) { return '<li><b>v' + x.version + '</b><span class="cx-muted">' + E(day(x.createdAt)) + '</span><p>' + E(x.notes || 'No notes.') + '</p></li>'; }).join('') : '<li class="cx-muted">No versions listed.</li>';
      }).catch(function () { var el = $('zs-vers'); if (el) el.innerHTML = '<li class="cx-muted">Could not load versions.</li>'; });
    }
    function ratings(ref, s, who) {
      ref.collection('ratings').orderBy('updatedAt', 'desc').limit(50).get().then(function (q) {
        var rows = q.docs.map(function (d) { var o = d.data(); o.id = d.id; return o; });
        var el = $('zs-ratings'); if (!el) return;
        var mineR = me ? rows.filter(function (x) { return x.uid === me.uid; })[0] : null;
        el.innerHTML = rows.length ? '<ul class="zs-rates">' + rows.map(function (x) {
          return '<li><div class="zs-rh"><span class="zs-st" aria-label="' + x.stars + ' of 5 stars">' + '★★★★★'.slice(0, x.stars) + '<span>' + '★★★★★'.slice(x.stars) + '</span></span><b>' + E(x.authorName) + '</b><span class="cx-muted">' + E(day(x.updatedAt)) + '</span>' +
            (who.isAdm ? '<button type="button" class="btn btn-ghost btn-sm" data-delr="' + E(x.id) + '" data-stars="' + x.stars + '">Remove</button>' : '') + '</div>' + (x.text ? '<p>' + E(x.text) + '</p>' : '') + '</li>';
        }).join('') + '</ul>' : '<p class="cx-muted">No ratings yet. Ratings come only from members who ' + (who.paid ? 'bought' : 'added') + ' this script.</p>';
        var canRate = me && !who.mine && s.status !== 'removed' && (who.paid ? who.owned : who.added);
        var w = $('zs-rate-w');
        if (w && canRate) { w.innerHTML = '<button type="button" class="btn btn-ghost btn-sm" id="zs-rate">' + (mineR ? 'Edit your rating' : 'Rate it') + '</button>'; $('zs-rate').onclick = function () { rate(ref, s, mineR); }; }
        el.onclick = function (e) {
          var b = e.target.closest('[data-delr]'); if (!b || !confirm('Remove this rating?')) return;
          var bt = db.batch(); bt.delete(ref.collection('ratings').doc(b.dataset.delr)); bt.update(ref, { ratingSum: inc(-(+b.dataset.stars)), ratingCount: inc(-1) });
          bt.commit().then(function () { script(s.sid); }).catch(function () { toast('error', 'Could not remove.'); });
        };
      }).catch(function () { var el = $('zs-ratings'); if (el) el.innerHTML = '<p class="cx-muted">Could not load ratings.</p>'; });
    }
    function rate(ref, s, cur) {
      var stars = cur ? cur.stars : 0;
      var sh = sheet('Rate ' + s.name, '<form class="cx-f" novalidate><div><label id="zr-l">Your rating</label><div class="zr-stars" role="radiogroup" aria-labelledby="zr-l">' +
        [1, 2, 3, 4, 5].map(function (n) { return '<button type="button" role="radio" data-n="' + n + '" aria-label="' + n + ' star' + (n > 1 ? 's' : '') + '">' + svg('star', 28) + '</button>'; }).join('') + '</div></div>' +
        '<div><label for="zr-t">What did you think? (optional)</label><textarea id="zr-t" maxlength="500" placeholder="How it works on your charts. No profit claims.">' + E(cur ? cur.text : '') + '</textarea></div>' +
        '<p class="cx-bad" id="zr-err" role="alert"></p><div class="cx-actions"><button type="submit" class="btn btn-primary" id="zr-go">Save rating</button></div></form>');
      function paint() { sh.el.querySelectorAll('[data-n]').forEach(function (b) { var on = +b.dataset.n <= stars; b.classList.toggle('on', on); b.setAttribute('aria-checked', +b.dataset.n === stars); }); }
      sh.el.querySelector('.zr-stars').onclick = function (e) { var b = e.target.closest('[data-n]'); if (b) { stars = +b.dataset.n; paint(); } };
      paint();
      sh.el.querySelector('form').onsubmit = function (e) {
        e.preventDefault();
        var err = sh.$('zr-err'), t = sh.$('zr-t').value.trim();
        if (!stars) { err.textContent = 'Pick 1 to 5 stars.'; return; }
        if (RISKY.test(t)) { err.textContent = 'Leave out profit or result claims.'; return; }
        var go = sh.$('zr-go'); busy(go, 'Saving…');
        profName(me).then(function (n) {
          var b = db.batch(), r = ref.collection('ratings').doc(me.uid);
          b.set(r, { uid: me.uid, stars: stars, text: t.slice(0, 500), authorName: n, createdAt: cur ? cur.createdAt : ts(), updatedAt: ts() });
          b.update(ref, cur ? { ratingSum: inc(stars - cur.stars) } : { ratingSum: inc(stars), ratingCount: inc(1) });
          return b.commit();
        }).then(function () { sh.close(); toast('success', 'Thanks for rating.'); script(s.sid); }).catch(function () { unbusy(go); err.textContent = 'Could not save your rating.'; });
      };
    }
    function report(sid) {
      var sh = sheet('Report this script', '<form class="cx-f" novalidate><fieldset style="border:0;padding:0;margin:0"><legend class="cx-muted" style="margin-bottom:8px">What is wrong?</legend>' +
        REASONS.map(function (r) { return '<label class="cx-ropt"><input type="radio" name="zrr" value="' + r[0] + '">' + r[1] + '</label>'; }).join('') + '</fieldset>' +
        '<div><label for="zrr-n">Details (optional)</label><textarea id="zrr-n" maxlength="500"></textarea></div><p class="cx-bad" id="zrr-err" role="alert"></p>' +
        '<div class="cx-actions"><button type="submit" class="btn btn-primary" id="zrr-go">Send report</button></div><p class="hint">TradeZoro reviews every report. The author is not told who reported.</p></form>');
      sh.el.querySelector('fieldset').onchange = function () { sh.$('zrr-err').textContent = ''; };
      sh.el.querySelector('form').onsubmit = function (e) {
        e.preventDefault();
        var r = sh.el.querySelector('input[name=zrr]:checked'); if (!r) { sh.$('zrr-err').textContent = 'Pick a reason.'; return; }
        var go = sh.$('zrr-go'); busy(go, 'Sending…');
        db.collection('zsReports').doc(sid + '_' + me.uid).set({ sid: sid, reporterUid: me.uid, reason: r.value, note: sh.$('zrr-n').value.trim().slice(0, 500), status: 'open', createdAt: ts() })
          .then(function () { sh.close(); toast('success', 'Report sent. Thank you.'); })
          .catch(function () { unbusy(go); sh.$('zrr-err').textContent = 'You already reported this script, or the report could not be sent.'; });
      };
    }

    user().then(function (u) { me = u; reload(); route(); });
  }
  g.ZSLib = ZSLib;
  if (typeof document !== 'undefined') { if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', gated); else gated(); }
})(typeof window !== 'undefined' ? window : globalThis);
