// Stryker Trading Academy — Admin: Notes (notes-admin.html + dashboard panel
// + the quick-notes drawer available from every admin page's sidebar)
// A shared scratchpad for the admin team: quick notes with a priority level,
// done-tracking, and a dashboard digest of what's still open. Completed notes
// are never lost — they move to History with who completed them and when.
// Stored in the 'adminNotes' collection (admins-only by rules).
// Loaded on ALL admin pages so the drawer works everywhere.
// Depends on: assets/admin-guard.js, assets/progress.js (db), assets/auth.js

var NOTES_PRI = {
  urgent: { label: 'URGENT', rank: 0, colour: '#e5484d' },
  high:   { label: 'HIGH',   rank: 1, colour: '#f5a524' },
  normal: { label: 'NORMAL', rank: 2, colour: '#f5c542' },
  low:    { label: 'LOW',    rank: 3, colour: '#8b93a0' }
};

var ADMIN_NOTES = [];
var NOTES_FILTER = 'open';
var QN_FILTER = 'open';

function notesEsc(s){
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function notesMillis(ts){
  return ts && typeof ts.toMillis === 'function' ? ts.toMillis() : 0;
}

function notesDay(ts){
  return ts && typeof ts.toDate === 'function'
    ? ts.toDate().toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '';
}

function notesLocalStamp(){
  return { toDate: function(){ return new Date(); }, toMillis: function(){ return Date.now(); } };
}

// Open notes: most urgent first, newest first within a priority.
function notesSorted(list){
  return list.slice().sort(function (a, b) {
    var pa = (NOTES_PRI[a.priority] || NOTES_PRI.normal).rank;
    var pb = (NOTES_PRI[b.priority] || NOTES_PRI.normal).rank;
    if (pa !== pb) return pa - pb;
    return notesMillis(b.createdAt) - notesMillis(a.createdAt);
  });
}

// History: most recently completed first (falls back to created date for
// notes completed before doneAt existed).
function notesHistorySorted(list){
  return list.slice().sort(function (a, b) {
    return (notesMillis(b.doneAt) || notesMillis(b.createdAt)) -
           (notesMillis(a.doneAt) || notesMillis(a.createdAt));
  });
}

function loadAdminNotes(){
  return db.collection('adminNotes').orderBy('createdAt', 'desc').limit(200).get()
    .then(function (snap) {
      ADMIN_NOTES = [];
      snap.forEach(function (doc) {
        var n = doc.data();
        n.id = doc.id;
        ADMIN_NOTES.push(n);
      });
      return ADMIN_NOTES;
    });
}

function noteChip(pri){
  var p = NOTES_PRI[pri] || NOTES_PRI.normal;
  return '<span class="note-pri" style="color:' + p.colour + '; border-color:' + p.colour + '55; background:' + p.colour + '14">' + p.label + '</span>';
}

function noteRowHtml(n){
  var meta = notesDay(n.createdAt) + (n.createdByName ? ' · ' + notesEsc(n.createdByName) : '');
  if (n.done) {
    var doneDay = notesDay(n.doneAt);
    meta += ' · <span style="color:var(--bull);">✔ ' +
      (doneDay ? doneDay : 'completed') +
      (n.doneByName ? ' by ' + notesEsc(n.doneByName) : '') + '</span>';
  }
  return '<div style="flex:1; min-width:0;">' +
      '<div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">' + noteChip(n.priority) +
        '<span class="cell-sub" style="margin:0;">' + meta + '</span></div>' +
      '<p style="font-size:13.5px; color:var(--ink-1); margin:7px 0 0; white-space:pre-wrap;' + (n.done ? ' text-decoration:line-through; color:var(--ink-3);' : '') + '">' + notesEsc(n.text) + '</p>' +
    '</div>' +
    '<div style="display:flex; flex-direction:column; gap:8px; flex-shrink:0;">' +
      '<button type="button" class="btn btn-ghost btn-sm" data-note-act="toggle" data-id="' + n.id + '">' + (n.done ? 'Reopen' : '✓ Done') + '</button>' +
      '<button type="button" class="btn btn-ghost btn-sm" data-note-act="delete" data-id="' + n.id + '" style="color:var(--bear);">Delete</button>' +
    '</div>';
}

function notesFillList(wrap, list, emptyMsg){
  if (!list.length) {
    wrap.innerHTML = '<p style="color:var(--ink-3); font-size:13.5px;">' + emptyMsg + '</p>';
    return;
  }
  wrap.innerHTML = '';
  list.forEach(function (n) {
    var row = document.createElement('div');
    row.className = 'record-card note-row' + (n.done ? ' is-done' : '');
    row.innerHTML = noteRowHtml(n);
    wrap.appendChild(row);
  });
}

function notesForFilter(filter){
  var open = notesSorted(ADMIN_NOTES.filter(function (n) { return !n.done; }));
  var done = notesHistorySorted(ADMIN_NOTES.filter(function (n) { return n.done; }));
  if (filter === 'open') return open;
  if (filter === 'done') return done;
  return open.concat(done);   // 'all': open work first, history below it
}

// ---- shared actions ---------------------------------------------------------
function notesAddFrom(textEl, priEl){
  var pri = priEl.value;
  var text = (textEl.value || '').trim().slice(0, 500);
  if (!text) { if (typeof showToast === 'function') showToast('error', 'Write the note first.'); return; }
  var me = (auth && auth.currentUser) || {};
  db.collection('adminNotes').add({
    text: text,
    priority: NOTES_PRI[pri] ? pri : 'normal',
    done: false,
    createdByUid: me.uid || null,
    createdByName: me.displayName || me.email || 'Admin',
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  }).then(function (ref) {
    ADMIN_NOTES.unshift({ id: ref.id, text: text, priority: pri, done: false,
      createdByName: me.displayName || me.email || 'Admin',
      createdAt: notesLocalStamp() });
    textEl.value = '';
    notesRefreshViews();
    if (typeof showToast === 'function') showToast('success', 'Note added.');
  }).catch(function (err) {
    if (typeof showToast === 'function') showToast('error', 'Could not save: ' + (err.message || err));
  });
}

function notesToggleDone(n){
  var me = (auth && auth.currentUser) || {};
  var patch = n.done
    ? { done: false,
        doneAt: firebase.firestore.FieldValue.delete(),
        doneByName: firebase.firestore.FieldValue.delete() }
    : { done: true,
        doneAt: firebase.firestore.FieldValue.serverTimestamp(),
        doneByName: me.displayName || me.email || 'Admin' };
  return db.collection('adminNotes').doc(n.id).set(patch, { merge: true }).then(function () {
    n.done = !n.done;
    if (n.done) {
      n.doneAt = notesLocalStamp();
      n.doneByName = me.displayName || me.email || 'Admin';
    } else {
      delete n.doneAt;
      delete n.doneByName;
    }
    notesRefreshViews();
  });
}

function notesDelete(n){
  if (!confirm('Delete this note permanently? Completed notes stay in History — you only need Delete for notes that should never have existed.')) return;
  db.collection('adminNotes').doc(n.id).delete().then(function () {
    ADMIN_NOTES = ADMIN_NOTES.filter(function (x) { return x.id !== n.id; });
    notesRefreshViews();
  });
}

function notesListClick(e){
  var btn = e.target.closest('[data-note-act]');
  if (!btn) return;
  var n = ADMIN_NOTES.find(function (x) { return x.id === btn.dataset.id; });
  if (!n) return;
  if (btn.dataset.noteAct === 'delete') notesDelete(n);
  else notesToggleDone(n);
}

function notesRefreshViews(){
  notesRenderList();
  notesRenderDash();
  qnRender();
}

// ---- full module page -------------------------------------------------------
function notesRenderList(){
  var wrap = document.getElementById('notes-list');
  if (!wrap) return;
  notesFillList(wrap, notesForFilter(NOTES_FILTER),
    NOTES_FILTER === 'open' ? 'No open notes — clean desk.' : 'Nothing here yet.');
}

// ---- dashboard digest panel -------------------------------------------------
function notesRenderDash(){
  var wrap = document.getElementById('dash-notes-list');
  if (!wrap) return;
  var open = notesSorted(ADMIN_NOTES.filter(function (n) { return !n.done; })).slice(0, 4);
  if (!open.length) {
    wrap.innerHTML = '<p style="color:var(--ink-3); font-size:13px;">No open notes. Add one from the Notes module.</p>';
    return;
  }
  wrap.innerHTML = open.map(function (n) {
    return '<div class="dash-note-line">' + noteChip(n.priority) +
      '<span>' + notesEsc(n.text.length > 90 ? n.text.slice(0, 90) + '…' : n.text) + '</span></div>';
  }).join('');
}

// ---- quick-notes drawer (every admin page except the module itself) ---------
function qnInject(){
  if (document.getElementById('qn-overlay')) return;

  // Sidebar entry lives in the always-visible Overview section, so it never
  // hides inside a collapsed accordion group.
  var section = null;
  document.querySelectorAll('.sidebar .side-section').forEach(function (sec) {
    var label = sec.querySelector('.side-label');
    if (!section && label && /overview/i.test(label.textContent)) section = sec;
  });
  if (!section) section = document.querySelector('.sidebar .side-section');
  if (!section) return;

  var link = document.createElement('a');
  link.href = '#';
  link.className = 'side-link';
  link.id = 'qn-open-btn';
  link.innerHTML =
    '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M15.5 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8.5z"/><path d="M15 3v6h6"/><path d="M8 13h8M8 17h5"/></svg>' +
    'Quick notes<span class="qn-count" id="qn-count" hidden></span>';
  section.appendChild(link);

  var overlay = document.createElement('div');
  overlay.className = 'qn-overlay';
  overlay.id = 'qn-overlay';
  overlay.hidden = true;
  overlay.innerHTML =
    '<div class="qn-drawer" role="dialog" aria-label="Quick notes">' +
      '<div class="qn-head">' +
        '<h3>Quick notes</h3>' +
        '<a href="notes-admin.html" class="qn-module-link">Open module ↗</a>' +
        '<button type="button" class="icon-btn" id="qn-close" aria-label="Close quick notes">' +
          '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>' +
        '</button>' +
      '</div>' +
      '<div class="qn-add">' +
        '<input type="text" id="qn-new-text" placeholder="What needs remembering?" maxlength="500">' +
        '<div class="qn-add-row">' +
          '<select id="qn-new-pri" class="journal-select">' +
            '<option value="normal">Normal</option>' +
            '<option value="urgent">Urgent</option>' +
            '<option value="high">High</option>' +
            '<option value="low">Low</option>' +
          '</select>' +
          '<button type="button" class="btn btn-primary btn-sm" id="qn-add-btn">Add note</button>' +
        '</div>' +
      '</div>' +
      '<div class="term-cats qn-tabs" id="qn-filter">' +
        '<button type="button" class="term-cat is-on" data-f="open">Open</button>' +
        '<button type="button" class="term-cat" data-f="done">History</button>' +
      '</div>' +
      '<div class="qn-list" id="qn-list"></div>' +
    '</div>';
  document.body.appendChild(overlay);

  function qnOpen(){
    overlay.hidden = false;
    requestAnimationFrame(function(){ overlay.classList.add('is-open'); });
    qnRender();
    var input = document.getElementById('qn-new-text');
    if (input && window.matchMedia && !window.matchMedia('(max-width: 900px)').matches) input.focus();
  }
  function qnClose(){
    overlay.classList.remove('is-open');
    setTimeout(function(){ overlay.hidden = true; }, 180);
  }

  link.addEventListener('click', function (e) { e.preventDefault(); qnOpen(); });
  document.getElementById('qn-close').addEventListener('click', qnClose);
  overlay.addEventListener('click', function (e) { if (e.target === overlay) qnClose(); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !overlay.hidden) qnClose();
  });

  document.getElementById('qn-add-btn').addEventListener('click', function () {
    notesAddFrom(document.getElementById('qn-new-text'), document.getElementById('qn-new-pri'));
  });
  document.getElementById('qn-new-text').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      notesAddFrom(document.getElementById('qn-new-text'), document.getElementById('qn-new-pri'));
    }
  });
  document.getElementById('qn-filter').addEventListener('click', function (e) {
    var btn = e.target.closest('.term-cat');
    if (!btn) return;
    QN_FILTER = btn.dataset.f;
    document.querySelectorAll('#qn-filter .term-cat').forEach(function (b) { b.classList.toggle('is-on', b === btn); });
    qnRender();
  });
  document.getElementById('qn-list').addEventListener('click', notesListClick);
}

function qnRender(){
  var badge = document.getElementById('qn-count');
  if (badge) {
    var open = ADMIN_NOTES.filter(function (n) { return !n.done; });
    badge.textContent = open.length;
    badge.hidden = !open.length;
    badge.classList.toggle('has-urgent', open.some(function (n) { return n.priority === 'urgent'; }));
  }
  var wrap = document.getElementById('qn-list');
  if (!wrap) return;
  notesFillList(wrap, notesForFilter(QN_FILTER),
    QN_FILTER === 'open' ? 'No open notes — clean desk.' : 'No completed notes yet.');
}

document.addEventListener('DOMContentLoaded', function () {
  var onModulePage = !!document.getElementById('notes-list');
  var onDashboard = !!document.getElementById('dash-notes-list');
  var hasSidebar = !!document.querySelector('.sidebar .side-section');
  if (!onModulePage && !onDashboard && !hasSidebar) return;

  guardAdminPage(function () {
    // The module page IS the full notes UI — no drawer needed there.
    if (!onModulePage && hasSidebar) qnInject();

    loadAdminNotes().then(function () {
      notesRefreshViews();
    }).catch(function (err) {
      var el = document.getElementById(onModulePage ? 'notes-list' : 'dash-notes-list');
      if (el) el.innerHTML = '<p style="color:var(--ink-3); font-size:13px;">Could not load notes: ' + (err.message || err) + '</p>';
    });

    if (!onModulePage) return;

    document.getElementById('note-add-btn').addEventListener('click', function () {
      notesAddFrom(document.getElementById('note-new-text'), document.getElementById('note-new-pri'));
    });
    document.getElementById('note-new-text').addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        notesAddFrom(document.getElementById('note-new-text'), document.getElementById('note-new-pri'));
      }
    });

    document.getElementById('notes-filter').addEventListener('click', function (e) {
      var btn = e.target.closest('.term-cat');
      if (!btn) return;
      NOTES_FILTER = btn.dataset.f;
      document.querySelectorAll('#notes-filter .term-cat').forEach(function (b) { b.classList.toggle('is-on', b === btn); });
      notesRenderList();
    });

    document.getElementById('notes-list').addEventListener('click', notesListClick);
  });
});
