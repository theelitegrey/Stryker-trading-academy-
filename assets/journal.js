// Stryker Trading Academy — Trade Journal (trade-journal.html)
// Depends on: assets/auth.js, assets/progress.js (for `db`)
// Entries live at students/{uid}/journal/{entryId} — private to the account,
// matching the same security-rule pattern as the rest of the student's data.

let JOURNAL_UID = null;

function outcomeTagClass(outcome){
  if (outcome === 'Win') return 'tag-foundation';
  if (outcome === 'Loss') return 'tag-advanced';
  if (outcome === 'Breakeven') return 'tag-intermediate';
  return '';
}

function renderJournalEntries(entries){
  const list = document.getElementById('journal-list');
  const countEl = document.getElementById('journal-count');
  if (countEl) countEl.textContent = entries.length + ' entr' + (entries.length === 1 ? 'y' : 'ies');

  if (!entries.length) {
    list.innerHTML = '<p style="color:var(--ink-3); font-size:13.5px;">No entries yet — log your first setup above.</p>';
    return;
  }

  list.innerHTML = '';
  entries.forEach((entry) => {
    const row = document.createElement('div');
    row.className = 'chapter';
    row.style.gridTemplateColumns = '1fr auto';
    row.innerHTML =
      '<div class="chapter-body">' +
        '<h3 style="font-size:15px;">' + (entry.instrument || 'Untitled') + ' · ' + entry.direction + '</h3>' +
        '<p>' + (entry.notes ? entry.notes.replace(/</g, '&lt;') : 'No notes.') + '</p>' +
        '<div class="chapter-meta">' +
          '<span class="chapter-tag ' + outcomeTagClass(entry.outcome) + '">' + entry.outcome + '</span>' +
          '<span>' + (entry.date || '') + '</span>' +
        '</div>' +
      '</div>' +
      '<div class="chapter-status"><button class="icon-btn" data-entry-id="' + entry.id + '" title="Delete entry">' +
        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14z"/></svg>' +
      '</button></div>';

    row.querySelector('[data-entry-id]').addEventListener('click', () => deleteJournalEntry(entry.id));
    list.appendChild(row);
  });
}

function loadJournalEntries(){
  db.collection('students').doc(JOURNAL_UID).collection('journal')
    .orderBy('date', 'desc')
    .get()
    .then((snap) => {
      const entries = [];
      snap.forEach((doc) => entries.push(Object.assign({ id: doc.id }, doc.data())));
      renderJournalEntries(entries);
    })
    .catch((err) => {
      console.error('Stryker: failed to load journal entries', err);
      document.getElementById('journal-list').innerHTML =
        '<p style="color:var(--ink-3); font-size:13.5px;">Could not load entries: ' + (err.message || err) + '</p>';
    });
}

function deleteJournalEntry(id){
  if (!confirm('Delete this journal entry? This cannot be undone.')) return;
  db.collection('students').doc(JOURNAL_UID).collection('journal').doc(id).delete()
    .then(loadJournalEntries)
    .catch((err) => alert('Could not delete entry: ' + (err.message || err)));
}

document.addEventListener('DOMContentLoaded', () => {
  if (!auth) return;

  const dateInput = document.getElementById('journal-date');
  dateInput.value = new Date().toISOString().slice(0, 10);

  let handled = false;
  auth.onAuthStateChanged((user) => {
    if (handled) return;
    if (!user) {
      setTimeout(() => { if (!handled) goToLoginPreservingReturn(); }, 1500);
      return;
    }
    handled = true;
    JOURNAL_UID = user.uid;
    loadJournalEntries();
  });

  document.getElementById('journal-add-btn').addEventListener('click', () => {
    const errEl = document.getElementById('journal-error');
    errEl.style.display = 'none';
    if (!JOURNAL_UID) return;

    const date = dateInput.value;
    const instrument = document.getElementById('journal-instrument').value.trim();
    const direction = document.getElementById('journal-direction').value;
    const outcome = document.getElementById('journal-outcome').value;
    const notes = document.getElementById('journal-notes').value.trim();

    if (!instrument) {
      errEl.textContent = 'Add an instrument before saving.';
      errEl.style.display = 'block';
      return;
    }

    const btn = document.getElementById('journal-add-btn');
    btn.disabled = true;

    db.collection('students').doc(JOURNAL_UID).collection('journal').add({
      date, instrument, direction, outcome, notes,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    }).then(() => {
      document.getElementById('journal-instrument').value = '';
      document.getElementById('journal-notes').value = '';
      loadJournalEntries();
    }).catch((err) => {
      errEl.textContent = err.message || 'Could not save entry.';
      errEl.style.display = 'block';
    }).finally(() => { btn.disabled = false; });
  });
});
