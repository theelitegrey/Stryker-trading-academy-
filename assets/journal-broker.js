// Stryker Trading Academy — Trade Journal: broker sync panel
// Depends on: Firebase compat SDK incl. firebase-functions-compat, auth,
// Firestore; the brokerSync Cloud Functions (functions-src/brokerSync.js).
//
// The panel lives on the History tab. It lists this student's broker
// connections from brokerSync/{uid}__{broker} (owner-readable, functions-
// only writable), and drives four callables: brokerCatalog (broker list +
// credential fields straight from the broker-sdk metadata), brokerConnect,
// brokerSyncNow, brokerDisconnect. Credentials go from the form to the
// callable and nowhere else; the server validates them against the broker,
// encrypts them, and never returns them.
//
// Everything degrades gracefully: if the functions aren't deployed yet, the
// first callable fails and the panel shows a one-line "not available yet"
// note instead of a broken form.

let JB_CATALOG = null;
let JB_CONNECTIONS = [];
let JB_UNSUB = null;

function jbFns(){
  try { return firebase.app().functions(); } catch (e) { return null; }
}

function jbEsc(s){
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function jbTimeAgo(ts){
  if (!ts) return '—';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  const mins = Math.max(0, Math.round((Date.now() - d.getTime()) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return mins + 'm ago';
  if (mins < 48 * 60) return Math.round(mins / 60) + 'h ago';
  return Math.round(mins / 1440) + 'd ago';
}

// ---- connections list -------------------------------------------------------

function jbRenderConnections(){
  const host = document.getElementById('jb-connections');
  if (!host) return;
  if (!JB_CONNECTIONS.length) {
    host.innerHTML = '<p style="color:var(--ink-3); font-size:13px; margin:0;">No broker connected yet. Connect one below and your fills import themselves — new trades land in the journal automatically every few hours.</p>';
    return;
  }
  host.innerHTML = JB_CONNECTIONS.map((c) => {
    const cat = (JB_CATALOG || []).find((b) => b.id === c.broker);
    const name = cat ? cat.displayName : c.broker;
    const ok = c.status !== 'error';
    return '<div class="jb-conn">' +
      '<span class="jb-dot ' + (ok ? 'ok' : 'err') + '"></span>' +
      '<div class="jb-conn-main">' +
        '<b>' + jbEsc(name) + '</b>' +
        '<span>' + jbEsc(c.statusDetail || (ok ? 'Connected' : 'Error')) + ' · synced ' + jbTimeAgo(c.lastSyncAt) + '</span>' +
      '</div>' +
      '<button class="btn btn-ghost btn-sm" data-jb-sync="' + jbEsc(c.broker) + '">Sync now</button>' +
      '<button class="btn btn-ghost btn-sm" data-jb-del="' + jbEsc(c.broker) + '" style="border-color:rgba(229,72,77,0.35);">Disconnect</button>' +
    '</div>';
  }).join('');

  host.querySelectorAll('[data-jb-sync]').forEach((btn) => btn.addEventListener('click', () => {
    btn.disabled = true; btn.textContent = 'Syncing…';
    jbFns().httpsCallable('brokerSyncNow')({ broker: btn.dataset.jbSync })
      .then((res) => {
        showToast('success', res.data.added + ' new trade' + (res.data.added === 1 ? '' : 's') + ' synced.');
        if (typeof reloadJournalData === 'function') reloadJournalData();
      })
      .catch((err) => showToast('error', err.message || 'Sync failed.'))
      .finally(() => { btn.disabled = false; btn.textContent = 'Sync now'; });
  }));

  host.querySelectorAll('[data-jb-del]').forEach((btn) => btn.addEventListener('click', () => {
    if (!confirm('Disconnect this broker? Trades already in your journal stay.')) return;
    btn.disabled = true;
    jbFns().httpsCallable('brokerDisconnect')({ broker: btn.dataset.jbDel })
      .then(() => showToast('success', 'Broker disconnected.'))
      .catch((err) => showToast('error', err.message || 'Could not disconnect.'))
      .finally(() => { btn.disabled = false; });
  }));
}

function jbWatchConnections(uid){
  if (JB_UNSUB) JB_UNSUB();
  JB_UNSUB = db.collection('brokerSync').where('uid', '==', uid)
    .onSnapshot((snap) => {
      JB_CONNECTIONS = [];
      snap.forEach((d) => JB_CONNECTIONS.push(d.data()));
      JB_CONNECTIONS.sort((a, b) => (a.broker || '').localeCompare(b.broker || ''));
      jbRenderConnections();
    }, () => { /* rules not published yet — leave the empty state */ });
}

// ---- connect form -----------------------------------------------------------

function jbRenderForm(){
  const sel = document.getElementById('jb-broker-select');
  const fields = document.getElementById('jb-fields');
  const guide = document.getElementById('jb-guide');
  if (!sel || !JB_CATALOG) return;
  const b = JB_CATALOG.find((x) => x.id === sel.value);
  if (!b) { fields.innerHTML = ''; guide.textContent = ''; return; }
  fields.innerHTML = b.credentials.map((f) =>
    '<div class="field" style="margin-bottom:10px;">' +
      '<label>' + jbEsc(f.label) + '</label>' +
      '<input type="' + (f.secret ? 'password' : 'text') + '" data-jb-cred="' + jbEsc(f.key) + '" autocomplete="off" spellcheck="false">' +
    '</div>').join('');
  guide.textContent = b.readOnlySetup;
}

function jbLoadCatalog(){
  const fns = jbFns();
  if (!fns) return;
  fns.httpsCallable('brokerCatalog')({})
    .then((res) => {
      JB_CATALOG = res.data.brokers || [];
      const sel = document.getElementById('jb-broker-select');
      sel.innerHTML = '<option value="">Choose a broker…</option>' +
        JB_CATALOG.map((b) => '<option value="' + jbEsc(b.id) + '">' + jbEsc(b.displayName) + '</option>').join('');
      document.getElementById('jb-form-wrap').style.display = '';
      const note = document.getElementById('jb-unavailable');
      if (note) note.style.display = 'none';
      jbRenderConnections();
    })
    .catch(() => {
      const note = document.getElementById('jb-unavailable');
      if (note) note.style.display = '';
    });
}

function jbConnect(){
  const sel = document.getElementById('jb-broker-select');
  if (!sel.value) { showToast('error', 'Choose a broker first.'); return; }
  const credentials = {};
  let missing = false;
  document.querySelectorAll('#jb-fields [data-jb-cred]').forEach((inp) => {
    const v = inp.value.trim();
    if (!v) missing = true;
    credentials[inp.dataset.jbCred] = v;
  });
  if (missing) { showToast('error', 'Fill in every credential field.'); return; }

  const btn = document.getElementById('jb-connect-btn');
  btn.disabled = true; btn.textContent = 'Checking with the broker…';
  jbFns().httpsCallable('brokerConnect')({ broker: sel.value, credentials })
    .then((res) => {
      showToast('success', 'Connected — ' + res.data.added + ' trade' + (res.data.added === 1 ? '' : 's') + ' imported.', { title: 'Broker linked' });
      document.querySelectorAll('#jb-fields [data-jb-cred]').forEach((inp) => { inp.value = ''; });
      sel.value = '';
      jbRenderForm();
      if (typeof reloadJournalData === 'function') reloadJournalData();
    })
    .catch((err) => showToast('error', err.message || 'The broker rejected the connection.'))
    .finally(() => { btn.disabled = false; btn.textContent = 'Connect broker'; });
}

// ---- wiring -----------------------------------------------------------------

document.addEventListener('DOMContentLoaded', () => {
  if (!document.getElementById('jb-panel')) return;
  document.getElementById('jb-broker-select').addEventListener('change', jbRenderForm);
  document.getElementById('jb-connect-btn').addEventListener('click', jbConnect);

  function wireAuth(tries){
    tries = tries || 0;
    if (typeof auth === 'undefined' || !auth) {
      if (tries < 120) setTimeout(() => wireAuth(tries + 1), 150);
      return;
    }
    auth.onAuthStateChanged((user) => {
      if (!user) return;
      jbLoadCatalog();
      jbWatchConnections(user.uid);
    });
  }
  wireAuth();
});
