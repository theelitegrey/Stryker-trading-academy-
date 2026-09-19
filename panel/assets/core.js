/* Master Panel — core: Firebase, auth gate, router, data store, UI helpers.
 *
 * The panel is a separate origin from strykertrading.com, so it holds its own
 * Firebase session and signs in on its own. Authorisation is unchanged: a user
 * is an admin if admins/{uid} exists, which is what the Firestore rules check.
 * The gate below is convenience — the rules are the boundary.
 */
var PANEL = (function () {
  'use strict';

  var firebaseConfig = {
    apiKey: "AIzaSyC8nqRVQ7wpuplYygZObKgNx2ojj5ZwbSQ",
    authDomain: "strykertrades-e0cd8.firebaseapp.com",
    projectId: "strykertrades-e0cd8",
    storageBucket: "strykertrades-e0cd8.firebasestorage.app",
    messagingSenderId: "950576868151",
    appId: "1:950576868151:web:0f204f6debee99beda08b2"
  };

  var auth = null, db = null, initError = null;
  try {
    firebase.initializeApp(firebaseConfig);
    auth = firebase.auth();
    db = firebase.firestore();
    auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(function (e) {
      console.warn('panel: persistence unavailable', e);
    });
  } catch (err) {
    initError = err;
    console.error('panel: firebase init failed', err);
  }

  // ---------------------------------------------------------------------
  // Escaping. Everything rendered here is typed by an admin, but an admin
  // pasting a vendor name with a quote in it should not break the markup,
  // and a compromised record should not become script.
  // ---------------------------------------------------------------------
  function esc(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function safeUrl(v) {
    var s = String(v || '').trim();
    return /^https?:\/\//i.test(s) ? s : '';
  }

  // ---------------------------------------------------------------------
  // Dates. Everything stored is an ISO 'YYYY-MM-DD' string, not a Timestamp:
  // these are calendar facts (a renewal is on the 4th wherever you are), and
  // a plain string exports, diffs and sorts without a timezone argument.
  // ---------------------------------------------------------------------
  var DAY = 86400000;
  function today() { return iso(new Date()); }
  function iso(d) {
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function parseISO(s) {
    if (!s) return null;
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s));
    if (!m) { var d = new Date(s); return isNaN(d) ? null : d; }
    return new Date(+m[1], +m[2] - 1, +m[3]);
  }
  function daysUntil(s) {
    var d = parseISO(s); if (!d) return null;
    return Math.round((d.getTime() - parseISO(today()).getTime()) / DAY);
  }
  function fmtDate(s) {
    var d = parseISO(s); if (!d) return '—';
    return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  }
  function fmtWhen(ms) {
    if (!ms) return '—';
    var diff = Date.now() - ms;
    if (diff < 60000) return 'just now';
    if (diff < 3600000) return Math.round(diff / 60000) + ' min ago';
    if (diff < 86400000) return Math.round(diff / 3600000) + ' h ago';
    return new Date(ms).toLocaleString();
  }
  function fmtNum(n, dp) {
    if (n == null || isNaN(n)) return '—';
    return Number(n).toLocaleString(undefined, {
      minimumFractionDigits: dp == null ? 0 : dp,
      maximumFractionDigits: dp == null ? 0 : dp
    });
  }

  // ---------------------------------------------------------------------
  // Store. Small collections, read once per session and kept in memory —
  // a panel used by one person does not need live listeners, and a cache
  // keeps every view instant after the first load.
  // ---------------------------------------------------------------------
  var cache = {};
  var COLLECTIONS = {
    sites:         'panelSites',
    subscriptions: 'panelSubscriptions',
    expenses:      'panelExpenses',
    incidents:     'panelIncidents',
    tasks:         'panelTasks'
  };

  function col(name) {
    var c = COLLECTIONS[name];
    if (!c) throw new Error('unknown collection ' + name);
    return db.collection(c);
  }
  function load(name, force) {
    if (!force && cache[name]) return Promise.resolve(cache[name]);
    return col(name).get().then(function (snap) {
      var out = [];
      snap.forEach(function (doc) {
        out.push(Object.assign({ id: doc.id }, doc.data()));
      });
      cache[name] = out;
      return out;
    }).catch(function (err) {
      console.error('panel: load ' + name + ' failed', err);
      toast('error', 'Could not load ' + name + ' (' + (err.code || err.message) + ').');
      cache[name] = cache[name] || [];
      return cache[name];
    });
  }
  function loadAll(force) {
    return Promise.all(Object.keys(COLLECTIONS).map(function (n) { return load(n, force); }))
      .then(function () { return cache; });
  }
  function save(name, id, data) {
    data = Object.assign({}, data, { updatedAt: Date.now() });
    var ref = id ? col(name).doc(id) : col(name).doc();
    if (!id) data.createdAt = Date.now();
    return ref.set(data, { merge: true }).then(function () {
      var list = cache[name] || (cache[name] = []);
      var i = list.findIndex(function (r) { return r.id === ref.id; });
      var row = Object.assign({ id: ref.id }, i >= 0 ? list[i] : {}, data);
      if (i >= 0) list[i] = row; else list.push(row);
      return row;
    });
  }
  function remove(name, id) {
    return col(name).doc(id).delete().then(function () {
      cache[name] = (cache[name] || []).filter(function (r) { return r.id !== id; });
    });
  }
  function get(name) { return cache[name] || []; }

  // Settings live in one document so a single read covers FX rates, budgets
  // and thresholds, and a single write saves them.
  var settings = null;
  var SETTINGS_DEFAULT = {
    baseCurrency: 'USD',
    rates: { USD: 1, INR: 0.012, EUR: 1.08, GBP: 1.27, AUD: 0.66, CAD: 0.73 },
    monthlyBudget: 0,
    renewalWarnDays: 14,
    sslWarnDays: 21,
    healthRepo: 'theelitegrey/Stryker-trading-academy-',
    healthBranch: 'panel-data'
  };
  function loadSettings(force) {
    if (settings && !force) return Promise.resolve(settings);
    return db.collection('settings').doc('masterPanel').get().then(function (doc) {
      var raw = doc.exists ? doc.data() : {};
      settings = Object.assign({}, SETTINGS_DEFAULT, raw);
      settings.rates = Object.assign({}, SETTINGS_DEFAULT.rates, raw.rates || {});
      return settings;
    }).catch(function (err) {
      console.warn('panel: settings read failed', err);
      settings = Object.assign({}, SETTINGS_DEFAULT);
      return settings;
    });
  }
  function saveSettings(patch) {
    settings = Object.assign({}, settings || SETTINGS_DEFAULT, patch);
    return db.collection('settings').doc('masterPanel')
      .set(settings, { merge: true }).then(function () { return settings; });
  }
  function cfg() { return settings || SETTINGS_DEFAULT; }

  // ---------------------------------------------------------------------
  // UI helpers
  // ---------------------------------------------------------------------
  function toast(kind, msg) {
    var wrap = document.getElementById('toasts');
    var el = document.createElement('div');
    el.className = 'toast' + (kind && kind !== 'ok' ? ' ' + kind : '');
    el.textContent = msg;
    wrap.appendChild(el);
    setTimeout(function () { el.remove(); }, kind === 'error' ? 7000 : 3800);
  }

  function closeModal() {
    document.getElementById('modal-back').hidden = true;
    document.getElementById('modal-body').innerHTML = '';
    document.getElementById('modal-foot').innerHTML = '';
  }

  /* Field spec: {key,label,type,options,required,placeholder,help,value}
     types: text | number | date | select | textarea | checkbox | url */
  function formModal(opts) {
    var body = document.getElementById('modal-body');
    var foot = document.getElementById('modal-foot');
    document.getElementById('modal-title').textContent = opts.title;

    var values = opts.values || {};
    body.innerHTML = opts.fields.map(function (f) {
      var v = values[f.key] != null ? values[f.key] : (f.value != null ? f.value : '');
      var id = 'f-' + f.key;
      var input;
      if (f.type === 'select') {
        input = '<select id="' + id + '">' + (f.options || []).map(function (o) {
          var val = typeof o === 'string' ? o : o.value;
          var lab = typeof o === 'string' ? o : o.label;
          return '<option value="' + esc(val) + '"' + (String(v) === String(val) ? ' selected' : '') + '>' + esc(lab) + '</option>';
        }).join('') + '</select>';
      } else if (f.type === 'textarea') {
        input = '<textarea id="' + id + '" placeholder="' + esc(f.placeholder || '') + '">' + esc(v) + '</textarea>';
      } else if (f.type === 'checkbox') {
        input = '<input type="checkbox" id="' + id + '" style="width:auto"' + (v ? ' checked' : '') + '>';
      } else {
        var t = f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : f.type === 'url' ? 'url' : 'text';
        input = '<input type="' + t + '" id="' + id + '" value="' + esc(v) + '"' +
          (f.type === 'number' ? ' step="any"' : '') +
          ' placeholder="' + esc(f.placeholder || '') + '"' + (f.required ? ' required' : '') + '>';
      }
      return '<label class="field"><span>' + esc(f.label) + (f.required ? ' *' : '') + '</span>' + input +
        (f.help ? '<span class="t-sub" style="display:block;margin-top:4px">' + esc(f.help) + '</span>' : '') +
        '</label>';
    }).join('');

    foot.innerHTML =
      (opts.onDelete ? '<button class="btn btn-danger" id="m-del">Delete</button>' : '') +
      '<span class="row-end"></span>' +
      '<button class="btn" id="m-cancel">Cancel</button>' +
      '<button class="btn btn-primary" id="m-save">' + esc(opts.saveLabel || 'Save') + '</button>';

    document.getElementById('modal-back').hidden = false;
    var first = body.querySelector('input,select,textarea');
    if (first) first.focus();

    document.getElementById('m-cancel').onclick = closeModal;
    if (opts.onDelete) {
      document.getElementById('m-del').onclick = function () {
        if (!confirm('Delete this record? This cannot be undone.')) return;
        Promise.resolve(opts.onDelete()).then(closeModal);
      };
    }
    document.getElementById('m-save').onclick = function () {
      var out = {}, bad = null;
      opts.fields.forEach(function (f) {
        var el = document.getElementById('f-' + f.key);
        var v = f.type === 'checkbox' ? el.checked
          : f.type === 'number' ? (el.value === '' ? null : Number(el.value))
            : el.value.trim();
        if (f.required && (v === '' || v == null)) bad = bad || f.label;
        out[f.key] = v;
      });
      if (bad) { toast('error', bad + ' is required.'); return; }
      Promise.resolve(opts.onSave(out)).then(closeModal).catch(function (err) {
        toast('error', 'Save failed: ' + (err.code || err.message));
      });
    };
  }

  function csv(rows, filename) {
    var cells = rows.map(function (r) {
      return r.map(function (c) {
        var s = String(c == null ? '' : c);
        return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      }).join(',');
    }).join('\n');
    download(new Blob([cells], { type: 'text/csv' }), filename);
  }
  function download(blob, filename) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
  }

  // ---------------------------------------------------------------------
  // Router — hash routes, one registered view per route.
  // ---------------------------------------------------------------------
  var views = {};
  function view(route, def) { views[route] = def; }
  function route() {
    return (location.hash.replace(/^#\/?/, '') || 'overview').split('?')[0];
  }
  function go(r) { location.hash = '#/' + r; }
  function render() {
    var r = route();
    var def = views[r] || views.overview;
    var host = document.getElementById('view');
    document.getElementById('view-title').textContent = def.title;
    document.querySelectorAll('.side-link').forEach(function (a) {
      a.classList.toggle('active', a.getAttribute('data-route') === r);
    });
    document.getElementById('side').classList.remove('open');
    host.innerHTML = '<div class="empty">Loading…</div>';
    Promise.resolve(def.render(host)).catch(function (err) {
      console.error('panel: view ' + r + ' failed', err);
      host.innerHTML = '<div class="card"><p class="empty">This view failed to render: ' +
        esc(err && err.message) + '</p></div>';
    });
  }

  return {
    get auth() { return auth; },
    get db() { return db; },
    initError: initError,
    esc: esc, safeUrl: safeUrl,
    today: today, iso: iso, parseISO: parseISO, daysUntil: daysUntil,
    fmtDate: fmtDate, fmtWhen: fmtWhen, fmtNum: fmtNum, DAY: DAY,
    load: load, loadAll: loadAll, save: save, remove: remove, get: get, col: col,
    loadSettings: loadSettings, saveSettings: saveSettings, cfg: cfg,
    toast: toast, formModal: formModal, closeModal: closeModal,
    csv: csv, download: download,
    view: view, render: render, go: go, route: route,
    user: null
  };
})();
