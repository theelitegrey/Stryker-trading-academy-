// Stryker Trading Academy — Admin: Chapters & Content overview (chapters-admin.html)
// Depends on: assets/auth.js, assets/progress.js (`db`), assets/admin-guard.js,
// assets/chapters-data.js (CHAPTERS_SEED, LEVEL_LABEL), assets/chapters-store.js
// (CHAPTERS, loadChapters)
//
// This page is now just the list + analytics. Actual editing happens on the
// dedicated chapter-editor.html page — a full-width, uncluttered layout with
// a real rich-text toolbar, instead of squeezing an edit form into a small
// expanding card here.

function renderChapterList(){
  const container = document.getElementById('chapter-editor-list');
  const countEl = document.getElementById('chapter-count');
  if (!container) return;

  if (countEl) countEl.textContent = CHAPTERS.length + ' chapter' + (CHAPTERS.length === 1 ? '' : 's');

  const importNotice = document.getElementById('import-notice');
  if (importNotice) {
    const usingSeedFallback = typeof CHAPTERS_SEED !== 'undefined' && CHAPTERS === CHAPTERS_SEED;
    importNotice.style.display = usingSeedFallback ? 'flex' : 'none';
  }

  if (!CHAPTERS.length) {
    container.innerHTML = '<p style="color:var(--ink-3); font-size:13.5px;">No chapters found.</p>';
    return;
  }

  container.innerHTML = '';
  const sorted = CHAPTERS.slice().sort((a, b) => a.num.localeCompare(b.num));

  sorted.forEach((ch) => {
    const card = document.createElement('div');
    card.className = 'record-card';
    card.innerHTML =
      '<div style="flex:1 1 260px;">' +
        '<span class="cell-name">' + ch.num + ' — ' + (ch.title || 'Untitled') + '</span>' +
        '<div class="chapter-meta" style="margin-top:6px;"><span class="chapter-tag ' + (typeof LEVEL_TAG_CLASS !== 'undefined' ? LEVEL_TAG_CLASS[ch.level] : '') + '">' + (LEVEL_LABEL[ch.level] || ch.level) + '</span><span>' + (ch.lessons ? ch.lessons.length : 0) + ' lessons</span><span>' + (ch.dur || '') + '</span></div>' +
      '</div>' +
      '<a href="chapter-editor.html?ch=' + encodeURIComponent(ch.num) + '" class="btn btn-primary btn-sm">Edit</a>';
    container.appendChild(card);
  });
}

function renderStatCards(students){
  const totalStudents = students.length;
  document.getElementById('chstat-total-students').textContent = totalStudents;

  if (!totalStudents) {
    document.getElementById('chstat-avg-completion').textContent = '0';
    document.getElementById('chstat-most-completed').textContent = '—';
    return;
  }

  const totalChaptersCompleted = students.reduce((sum, s) => sum + ((s.completedChapters || []).length), 0);
  document.getElementById('chstat-avg-completion').textContent = (totalChaptersCompleted / totalStudents).toFixed(1);

  const counts = {};
  CHAPTERS.forEach(ch => { counts[ch.num] = 0; });
  students.forEach(s => {
    (s.completedChapters || []).forEach(num => { if (counts.hasOwnProperty(num)) counts[num]++; });
  });
  let mostCompletedChapter = null, mostCount = -1;
  CHAPTERS.forEach(ch => {
    if (counts[ch.num] > mostCount) { mostCount = counts[ch.num]; mostCompletedChapter = ch; }
  });
  document.getElementById('chstat-most-completed').textContent = mostCompletedChapter ? ('Ch. ' + mostCompletedChapter.num) : '—';
}

function importBundledChapters(triggerBtn){
  if (typeof CHAPTERS_SEED === 'undefined') { showToast('success', 'Bundled seed data is not available.'); return; }
  if (!confirm('Update all ' + CHAPTERS_SEED.length + ' chapters with the latest bundled content? This overwrites every chapter currently in Firestore with whatever is in the seed right now — including any chapter you may have hand-edited directly in the chapter editor beyond what was last pushed to the seed.')) return;

  const errEl = document.getElementById('update-all-error');
  const okEl = document.getElementById('update-all-success');
  if (errEl) errEl.style.display = 'none';
  if (okEl) okEl.style.display = 'none';
  if (triggerBtn) { triggerBtn.disabled = true; triggerBtn.textContent = 'Updating…'; }

  // Use allSettled (not all) so one chapter failing doesn't hide the status of
  // every other chapter — each write is independent and gets its own result,
  // so we can tell the user exactly which chapters succeeded and which didn't.
  const writes = CHAPTERS_SEED.map((ch) =>
    db.collection('chapters').doc(ch.num).set(ch)
      .then(() => ({ num: ch.num, ok: true }))
      .catch((err) => ({ num: ch.num, ok: false, error: err && (err.message || String(err)) }))
  );

  // One line per bulk publish, not one per chapter — 42 identical entries
  // would bury everything else in the log.
  if (typeof logActivity === 'function') logActivity('content.chapter_saved',
    'Published the chapter set (' + writes.length + ' chapters)');

  Promise.allSettled(writes)
    .then((results) => {
      const outcomes = results.map((r) => r.value || { ok: false, error: 'unknown failure' });
      const failed = outcomes.filter((o) => !o.ok);
      const succeeded = outcomes.filter((o) => o.ok);
      return loadChapters(true).then(() => ({ failed, succeeded }));
    })
    .then(({ failed, succeeded }) => {
      renderChapterList();
      if (failed.length === 0) {
        if (okEl) {
          okEl.textContent = 'All ' + succeeded.length + ' chapters updated from the latest bundled content.';
          okEl.style.display = 'block';
          if (typeof showToast === 'function') showToast('success', 'All ' + succeeded.length + ' chapters updated from the latest bundled content.');
        } else {
          showToast('success', 'Import complete.');
        }
      } else {
        const msg = failed.length + ' of ' + CHAPTERS_SEED.length + ' chapters FAILED to update: chapter(s) '
          + failed.map((f) => f.num).join(', ') + '. First error: ' + failed[0].error
          + '. The other ' + succeeded.length + ' chapters updated successfully.';
        if (errEl) { errEl.textContent = msg; errEl.style.display = 'block'; } else { showToast('success', msg); }
        console.error('Stryker: chapter update failures', failed);
      }
    })
    .finally(() => {
      if (triggerBtn) { triggerBtn.disabled = false; triggerBtn.textContent = 'Update all'; }
    });
}

document.addEventListener('DOMContentLoaded', () => {
  guardAdminPage(() => {
    Promise.all([db.collection('students').get(), loadChapters()])
      .then(([snap]) => {
        const students = [];
        snap.forEach((doc) => students.push(doc.data()));
        renderStatCards(students);
        renderChapterList();
      })
      .catch((err) => {
        console.error('Stryker: failed to load chapters/content admin page', err);
        document.getElementById('chapter-editor-list').innerHTML =
          '<p style="color:var(--ink-3); font-size:13.5px;">Could not load: ' + (err.message || err) + '</p>';
      });

    document.getElementById('import-btn').addEventListener('click', () => importBundledChapters());
    document.getElementById('update-all-btn').addEventListener('click', (e) => importBundledChapters(e.target));
  });
});
