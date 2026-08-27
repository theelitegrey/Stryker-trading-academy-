// Stryker Trading Academy — Admin: Notes (notes-admin.html + dashboard panel)
// A shared scratchpad for the admin team: quick notes with a priority level,
// done-tracking, and a dashboard digest of what's still open. Stored in the
// 'adminNotes' collection (admins-only by rules, same as other admin data).
// Depends on: assets/admin-guard.js, assets/progress.js (db), assets/auth.js

var NOTES_PRI = {
  urgent: { label: 'URGENT', rank: 0, colour: '#e5484d' },
  high:   { label: 'HIGH',   rank: 1, colour: '#f5a524' },
  normal: { label: 'NORMAL', rank: 2, colour: '#f5c542' },
  low:    { label: 'LOW',    rank: 3, colour: '#8b93a0' }
};

var ADMIN_NOTES = [];
var NOTES_FILTER = 'open';

function notesEsc(s){
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function notesSorted(list){
  return list.slice().sort(function (a, b) {
    var pa = (NOTES_PRI[a.priority] || NOTES_PRI.normal).rank;
    var pb = (NOTES_PRI[b.priority] || NOTES_PRI.normal).rank;
    if (pa !== pb) return pa - pb;
    var ta = a.createdAt && a.createdAt.toMillis ? a.createdAt.toMillis() : 0;
    var tb = b.createdAt && b.createdAt.toMillis ? b.createdAt.toMillis() : 0;
    return tb - ta;
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

// ---- full module page -------------------------------------------------------
function notesRenderList(){
  var wrap = document.getElementById('notes-list');
  if (!wrap) return;
  var shown = ADMIN_NOTES.filter(function (n) {
    return NOTES_FILTER === 'all' || (NOTES_FILTER === 'done' ? n.done : !n.done);
  });
  if (!shown.length) {
    wrap.innerHTML = '<p style="color:var(--ink-3); font-size:13.5px;">' +
      (NOTES_FILTER === 'open' ? 'No open notes — clean desk.' : 'Nothing here.') + '</p>';
    return;
  }
  wrap.innerHTML = '';
  notesSorted(shown).forEach(function (n) {
    var when = n.createdAt && typeof n.createdAt.toDate === 'function'
      ? n.createdAt.toDate().toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '';
    var row = document.createElement('div');
    row.className = 'record-card note-row' + (n.done ? ' is-done' : '');
    row.innerHTML =
      '<div style="flex:1; min-width:0;">' +
        '<div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">' + noteChip(n.priority) +
          '<span class="cell-sub" style="margin:0;">' + when + (n.createdByName ? ' · ' + notesEsc(n.createdByName) : '') + '</span></div>' +
        '<p style="font-size:13.5px; color:var(--ink-1); margin:7px 0 0; white-space:pre-wrap;' + (n.done ? ' text-decoration:line-through; color:var(--ink-3);' : '') + '">' + notesEsc(n.text) + '</p>' +
      '</div>' +
      '<div style="display:flex; flex-direction:column; gap:8px; flex-shrink:0;">' +
        '<button type="button" class="btn btn-ghost btn-sm" data-note-act="toggle" data-id="' + n.id + '">' + (n.done ? 'Reopen' : '✓ Done') + '</button>' +
        '<button type="button" class="btn btn-ghost btn-sm" data-note-act="delete" data-id="' + n.id + '" style="color:var(--bear);">Delete</button>' +
      '</div>';
    wrap.appendChild(row);
  });
}

function notesAdd(){
  var input = document.getElementById('note-new-text');
  var pri = document.getElementById('note-new-pri').value;
  var text = (input.value || '').trim().slice(0, 500);
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
      createdAt: { toDate: function(){ return new Date(); }, toMillis: function(){ return Date.now(); } } });
    input.value = '';
    notesRenderList();
    if (typeof showToast === 'function') showToast('success', 'Note added.');
  }).catch(function (err) {
    if (typeof showToast === 'function') showToast('error', 'Could not save: ' + (err.message || err));
  });
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

document.addEventListener('DOMContentLoaded', function () {
  var onModulePage = !!document.getElementById('notes-list');
  var onDashboard = !!document.getElementById('dash-notes-list');
  if (!onModulePage && !onDashboard) return;

  guardAdminPage(function () {
    loadAdminNotes().then(function () {
      notesRenderList();
      notesRenderDash();
    }).catch(function (err) {
      var el = document.getElementById(onModulePage ? 'notes-list' : 'dash-notes-list');
      if (el) el.innerHTML = '<p style="color:var(--ink-3); font-size:13px;">Could not load notes: ' + (err.message || err) + '</p>';
    });

    if (!onModulePage) return;

    document.getElementById('note-add-btn').addEventListener('click', notesAdd);
    document.getElementById('note-new-text').addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); notesAdd(); }
    });

    document.getElementById('notes-filter').addEventListener('click', function (e) {
      var btn = e.target.closest('.term-cat');
      if (!btn) return;
      NOTES_FILTER = btn.dataset.f;
      document.querySelectorAll('#notes-filter .term-cat').forEach(function (b) { b.classList.toggle('is-on', b === btn); });
      notesRenderList();
    });

    document.getElementById('notes-list').addEventListener('click', function (e) {
      var btn = e.target.closest('[data-note-act]');
      if (!btn) return;
      var n = ADMIN_NOTES.find(function (x) { return x.id === btn.dataset.id; });
      if (!n) return;
      if (btn.dataset.noteAct === 'delete') {
        if (!confirm('Delete this note?')) return;
        db.collection('adminNotes').doc(n.id).delete().then(function () {
          ADMIN_NOTES = ADMIN_NOTES.filter(function (x) { return x.id !== n.id; });
          notesRenderList();
        });
      } else {
        db.collection('adminNotes').doc(n.id).set({ done: !n.done }, { merge: true }).then(function () {
          n.done = !n.done;
          notesRenderList();
        });
      }
    });
  });
});
