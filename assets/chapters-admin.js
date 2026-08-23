// Stryker Trading Academy — Admin: Chapters & Content (chapters-admin.html)
// Depends on: assets/auth.js, assets/progress.js (`db`), assets/admin-guard.js,
// assets/chapters-data.js (CHAPTERS_SEED, LEVEL_LABEL), assets/chapters-store.js
// (CHAPTERS, loadChapters)
//
// Real content editing: every field below writes directly to a document in
// Firestore's `chapters` collection. Firestore security rules restrict
// writes to that collection to accounts with a matching /admins/{uid} doc —
// the same real enforcement used everywhere else in the admin area.

let EXPANDED_CHAPTER = null;

function nextChapterNum(){
  const nums = CHAPTERS.map(c => parseInt(c.num, 10)).filter(n => !isNaN(n));
  const max = nums.length ? Math.max(...nums) : 0;
  return String(max + 1).padStart(2, '0');
}

function emptyChapter(num){
  return {
    num, title: 'Untitled chapter', level: 'foundation', dur: '30 min',
    video: '', paragraphs: [''], lessons: [{ title: '', desc: '' }]
  };
}

function lessonRowHtml(lesson, idx){
  return (
    '<div class="lesson-edit-row" data-lesson-idx="' + idx + '">' +
      '<div class="field"><label>Lesson ' + (idx + 1) + ' title</label><input type="text" class="lesson-title-input" value="' + (lesson.title || '').replace(/"/g, '&quot;') + '"></div>' +
      '<div class="field" style="flex:2 1 260px;"><label>Description</label><input type="text" class="lesson-desc-input" value="' + (lesson.desc || '').replace(/"/g, '&quot;') + '"></div>' +
      '<button type="button" class="icon-btn remove-lesson-btn" title="Remove lesson"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg></button>' +
    '</div>'
  );
}

function editFormHtml(ch){
  const lessonsHtml = ch.lessons.map((l, i) => lessonRowHtml(l, i)).join('');
  return (
    '<div class="form-row-2">' +
      '<div class="field"><label>Title</label><input type="text" class="edit-title">' + '</div>' +
      '<div class="field"><label>Level</label>' +
        '<select class="edit-level" style="width:100%; padding:12px 14px; border-radius:8px; border:1px solid var(--line); background:var(--bg-2); color:var(--ink-0); font-size:14px;">' +
          '<option value="foundation">Foundation</option>' +
          '<option value="intermediate">Intermediate</option>' +
          '<option value="advanced">Advanced</option>' +
        '</select>' +
      '</div>' +
    '</div>' +
    '<div class="form-row-2">' +
      '<div class="field"><label>Duration</label><input type="text" class="edit-dur" placeholder="e.g. 48 min"></div>' +
      '<div class="field"><label>Video URL</label><input type="text" class="edit-video" placeholder="https://…"></div>' +
    '</div>' +
    '<div class="field"><label>Chapter text (separate paragraphs with a blank line)</label>' +
      '<textarea class="edit-paragraphs textarea-field" rows="6"></textarea>' +
    '</div>' +
    '<div class="field"><label>Lessons</label><div class="lesson-edit-rows">' + lessonsHtml + '</div>' +
      '<button type="button" class="btn btn-ghost btn-sm add-lesson-btn">+ Add lesson</button>' +
    '</div>' +
    '<div style="display:flex; gap:10px; flex-wrap:wrap; margin-top:6px;">' +
      '<button type="button" class="btn btn-primary btn-sm save-chapter-btn">Save changes</button>' +
      '<button type="button" class="btn btn-ghost btn-sm delete-chapter-btn" style="border-color:rgba(229,72,77,0.35);">Delete chapter</button>' +
    '</div>' +
    '<div class="auth-error chapter-save-error"></div>'
  );
}

function fillEditForm(cardEl, ch){
  cardEl.querySelector('.edit-title').value = ch.title || '';
  cardEl.querySelector('.edit-level').value = ch.level || 'foundation';
  cardEl.querySelector('.edit-dur').value = ch.dur || '';
  cardEl.querySelector('.edit-video').value = ch.video || '';
  cardEl.querySelector('.edit-paragraphs').value = (ch.paragraphs || []).join('\n\n');
}

function collectFormData(cardEl, num){
  const lessons = [];
  cardEl.querySelectorAll('.lesson-edit-row').forEach((row) => {
    const title = row.querySelector('.lesson-title-input').value.trim();
    const desc = row.querySelector('.lesson-desc-input').value.trim();
    if (title || desc) lessons.push({ title, desc });
  });
  const paragraphs = cardEl.querySelector('.edit-paragraphs').value
    .split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);

  return {
    num,
    title: cardEl.querySelector('.edit-title').value.trim() || 'Untitled chapter',
    level: cardEl.querySelector('.edit-level').value,
    dur: cardEl.querySelector('.edit-dur').value.trim(),
    video: cardEl.querySelector('.edit-video').value.trim(),
    paragraphs: paragraphs.length ? paragraphs : [''],
    lessons: lessons.length ? lessons : [{ title: '', desc: '' }]
  };
}

function wireEditForm(cardEl, ch){
  cardEl.querySelector('.add-lesson-btn').addEventListener('click', () => {
    const rows = cardEl.querySelector('.lesson-edit-rows');
    const idx = rows.querySelectorAll('.lesson-edit-row').length;
    rows.insertAdjacentHTML('beforeend', lessonRowHtml({ title: '', desc: '' }, idx));
    wireRemoveButtons(cardEl);
  });
  wireRemoveButtons(cardEl);

  cardEl.querySelector('.save-chapter-btn').addEventListener('click', () => {
    const errEl = cardEl.querySelector('.chapter-save-error');
    errEl.style.display = 'none';
    const data = collectFormData(cardEl, ch.num);
    const btn = cardEl.querySelector('.save-chapter-btn');
    btn.disabled = true;
    db.collection('chapters').doc(ch.num).set(data)
      .then(() => loadChapters(true))
      .then(() => renderChapterList())
      .catch((err) => {
        errEl.textContent = err.message || 'Could not save chapter.';
        errEl.style.display = 'block';
        btn.disabled = false;
      });
  });

  cardEl.querySelector('.delete-chapter-btn').addEventListener('click', () => {
    if (!confirm('Delete Chapter ' + ch.num + ' — "' + ch.title + '"? This removes it from the live curriculum immediately. This cannot be undone.')) return;
    db.collection('chapters').doc(ch.num).delete()
      .then(() => loadChapters(true))
      .then(() => renderChapterList())
      .catch((err) => alert('Could not delete: ' + (err.message || err)));
  });
}

function wireRemoveButtons(cardEl){
  cardEl.querySelectorAll('.remove-lesson-btn').forEach((btn) => {
    btn.onclick = () => {
      const rows = cardEl.querySelectorAll('.lesson-edit-row');
      if (rows.length <= 1) { alert('A chapter needs at least one lesson.'); return; }
      btn.closest('.lesson-edit-row').remove();
    };
  });
}

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
    card.className = 'chapter-edit-card';
    const isOpen = EXPANDED_CHAPTER === ch.num;

    card.innerHTML =
      '<div style="display:flex; justify-content:space-between; align-items:center; gap:12px; cursor:pointer;" class="chapter-edit-header">' +
        '<div>' +
          '<h3 style="font-size:15px; color:var(--ink-0); margin-bottom:4px;">' + ch.num + ' — ' + ch.title + '</h3>' +
          '<div class="chapter-meta"><span class="chapter-tag ' + (typeof LEVEL_TAG_CLASS !== 'undefined' ? LEVEL_TAG_CLASS[ch.level] : '') + '">' + (LEVEL_LABEL[ch.level] || ch.level) + '</span><span>' + (ch.lessons ? ch.lessons.length : 0) + ' lessons</span><span>' + (ch.dur || '') + '</span></div>' +
        '</div>' +
        '<button type="button" class="btn btn-ghost btn-sm toggle-edit-btn">' + (isOpen ? 'Close' : 'Edit') + '</button>' +
      '</div>' +
      '<div class="chapter-edit-form" style="display:' + (isOpen ? 'block' : 'none') + '; margin-top:16px;"></div>';

    const formWrap = card.querySelector('.chapter-edit-form');
    if (isOpen) {
      formWrap.innerHTML = editFormHtml(ch);
      fillEditForm(card, ch);
      wireEditForm(card, ch);
    }

    card.querySelector('.chapter-edit-header').addEventListener('click', () => {
      const nowOpen = EXPANDED_CHAPTER === ch.num;
      EXPANDED_CHAPTER = nowOpen ? null : ch.num;
      renderChapterList();
    });

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

function importBundledChapters(){
  if (typeof CHAPTERS_SEED === 'undefined') { alert('Bundled seed data is not available.'); return; }
  if (!confirm('Import all ' + CHAPTERS_SEED.length + ' bundled chapters into Firestore? This will overwrite any chapters already there with matching numbers.')) return;

  const writes = CHAPTERS_SEED.map((ch) => db.collection('chapters').doc(ch.num).set(ch));
  Promise.all(writes)
    .then(() => loadChapters(true))
    .then(() => { renderChapterList(); alert('Import complete.'); })
    .catch((err) => alert('Import failed partway through: ' + (err.message || err)));
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

    document.getElementById('add-chapter-btn').addEventListener('click', () => {
      const num = nextChapterNum();
      db.collection('chapters').doc(num).set(emptyChapter(num))
        .then(() => loadChapters(true))
        .then(() => { EXPANDED_CHAPTER = num; renderChapterList(); })
        .catch((err) => alert('Could not create chapter: ' + (err.message || err)));
    });

    document.getElementById('import-btn').addEventListener('click', importBundledChapters);
  });
});
