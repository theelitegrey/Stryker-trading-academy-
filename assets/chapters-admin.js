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
    const usingSeedFallback = typeof CHAPTERS_FROM_SEED !== 'undefined' && CHAPTERS_FROM_SEED;
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
        '<span class="cell-name">' + stkEsc(ch.num) + ' — ' + stkEsc(ch.title || 'Untitled') + '</span>' +
        '<div class="chapter-meta" style="margin-top:6px;"><span class="chapter-tag ' + (typeof LEVEL_TAG_CLASS !== 'undefined' ? LEVEL_TAG_CLASS[ch.level] : '') + '">' + (LEVEL_LABEL[ch.level] || ch.level) + '</span><span>' + (ch.lessons ? ch.lessons.length : 0) + ' lessons</span><span>' + (ch.dur || '') + '</span></div>' +
      '</div>' +
      '<a href="chapter-editor.html?ch=' + encodeURIComponent(ch.num) + '" class="btn btn-primary btn-sm">Edit</a>';
    container.appendChild(card);
  });
}

// ---- Stat cards -------------------------------------------------------------
//
// These three cards used to be computed in the browser from
// db.collection('students').get() — an unprojected download of EVERY student
// document (names, emails, plans, streaks) just to produce three summary
// numbers that display none of it. That was the last unbounded student scan on
// the site, it grew linearly with the member base, and it did not benefit from
// the bot- exclusion shipped in 345, so this page and the main dashboard could
// disagree about the member count.
//
// They now read the adminStats/current snapshot the scheduled function already
// writes: one document read instead of N, bot-filtered, and computed from the
// same source the main dashboard uses, so the two pages cannot drift apart.
//
// Definitions note: the old card summed RAW completedChapters array lengths,
// counting duplicates and ids no longer in the catalogue. chapterCompletions
// de-duplicates per student and counts catalogue ids only, so a stale id can't
// inflate the average. Measured on live data before the swap: both definitions
// gave 0.9 (48 completions / 56 students, 0 duplicates, 0 unknown ids).

function chRelativeTime(ms){
  if (!ms) return null;
  var diff = Date.now() - ms;
  if (diff < 0) diff = 0;
  var m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return m + ' min ago';
  var h = Math.floor(m / 60);
  if (h < 24) return h + 'h ago';
  return Math.floor(h / 24) + 'd ago';
}

// The freshness line is created here rather than in chapters-admin.html so this
// change stays within a single file, as scoped.
function chSetFreshness(text){
  var grid = document.querySelector('.stat-grid-3');
  if (!grid) return;
  var el = document.getElementById('chstat-updated');
  if (!el) {
    el = document.createElement('div');
    el.id = 'chstat-updated';
    el.style.cssText = 'font-family:var(--font-mono); font-size:12px; color:var(--ink-3); margin:-4px 0 14px;';
    grid.parentNode.insertBefore(el, grid.nextSibling);
  }
  el.textContent = text || '';
}

function chSet(id, value){
  var el = document.getElementById(id);
  if (el) el.textContent = value;
}

// stats: the adminStats/current document data, or null/undefined when the
// snapshot has never been generated or could not be read. Never throws, and
// never falls back to scanning students — a missing snapshot shows a dash.
function renderStatCards(stats){
  if (!stats) {
    chSet('chstat-total-students', '—');
    chSet('chstat-avg-completion', '—');
    chSet('chstat-most-completed', '—');
    chSetFreshness('Stats not yet generated — they appear after the next scheduled refresh.');
    return;
  }

  var totalStudents = typeof stats.totalUsers === 'number' ? stats.totalUsers : 0;
  chSet('chstat-total-students', totalStudents);

  var counts = stats.chapterCompletions || {};
  var ids = Object.keys(counts);

  var sum = 0;
  for (var i = 0; i < ids.length; i++) {
    var n = counts[ids[i]];
    if (typeof n === 'number' && isFinite(n)) sum += n;
  }
  chSet('chstat-avg-completion', totalStudents ? (sum / totalStudents).toFixed(1) : '0');

  // Argmax over the completion counts. Ties break toward the chapter that comes
  // first in the catalogue (CHAPTERS order), so the card is stable between
  // loads instead of depending on object key order; with no catalogue loaded,
  // fall back to the snapshot's own key order.
  var order = (typeof CHAPTERS !== 'undefined' && CHAPTERS && CHAPTERS.length)
    ? CHAPTERS.map(function (ch) { return String(ch.num); })
    : ids;
  var best = null, bestCount = -1;
  for (var j = 0; j < order.length; j++) {
    var id = order[j];
    var c = counts[id];
    if (typeof c === 'number' && isFinite(c) && c > bestCount) { bestCount = c; best = id; }
  }
  chSet('chstat-most-completed', (best !== null && bestCount > 0) ? ('Ch. ' + best) : '—');

  var ms = (stats.generatedAt && stats.generatedAt.toMillis) ? stats.generatedAt.toMillis() : null;
  var rel = chRelativeTime(ms);
  chSetFreshness(rel ? ('Stats updated ' + rel) : '');
}

function importBundledChapters(triggerBtn){
  if (typeof CHAPTERS_SEED === 'undefined' || !CHAPTERS_SEED.some((c) => c.bodyHtml)) { showToast('success', 'Bundled seed data is not available.'); return; }
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
    Promise.all([
      // One document read, replacing db.collection('students').get().
      // A failed or missing snapshot degrades to the dash state rather than
      // rejecting, so the chapter list below still renders.
      db.collection('adminStats').doc('current').get()
        .then(function (doc) { return doc.exists ? doc.data() : null; })
        .catch(function (err) {
          console.error('Stryker: adminStats/current read failed', err);
          return null;
        }),
      loadChapters(),
    ])
      .then(([stats]) => {
        renderStatCards(stats);
        renderChapterList();
      })
      .catch((err) => {
        console.error('Stryker: failed to load chapters/content admin page', err);
        document.getElementById('chapter-editor-list').innerHTML =
          '<p style="color:var(--ink-3); font-size:13.5px;">Could not load: ' + (err.message || err) + '</p>';
      });

    // Bulk import/update from the bundled seed moved server-side: the seed
    // on the site is catalog-only now (chapter text is plan-gated), so the
    // browser has no text to push. Use tools/chapter-gate/migrate.py.
    const importBtn = document.getElementById('import-btn');
    if (importBtn) importBtn.hidden = true;
  });
});
