// Stryker Trading Academy — dedicated Chapter Editor (chapter-editor.html)
// Depends on: assets/auth.js, assets/progress.js (`db`), assets/admin-guard.js,
// assets/chapters-data.js (CHAPTERS_SEED fallback), assets/chapters-store.js
// (CHAPTERS, loadChapters)
//
// Chapter text is stored as real HTML (field: bodyHtml) so bold/italic/
// underline/headings/lists survive exactly as formatted. A derived plain-
// text `paragraphs` array is also saved alongside it purely so older code
// (like the curriculum page's preview snippet) still has plain text to
// truncate, without needing every consumer rewritten at once.

let EDITING_NUM = null;
let IS_NEW_CHAPTER = false;

function getQueryParam(name){
  return new URLSearchParams(window.location.search).get(name);
}

function htmlToParagraphs(html){
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  const blocks = tmp.querySelectorAll('p, li, h3');
  const out = [];
  blocks.forEach((b) => { const t = b.textContent.trim(); if (t) out.push(t); });
  if (!out.length) {
    const plain = tmp.textContent.trim();
    if (plain) out.push(plain);
  }
  return out.length ? out : [''];
}

function paragraphsToHtml(paragraphs){
  return (paragraphs || []).map(p => '<p>' + p.replace(/</g, '&lt;') + '</p>').join('');
}

function lessonRowHtml(lesson, idx){
  const descHtml = lesson.descHtml || (lesson.desc ? '<p>' + String(lesson.desc).replace(/</g, '&lt;') + '</p>' : '');
  return (
    '<div class="lesson-edit-row" data-lesson-idx="' + idx + '">' +
      '<div class="field"><label>Lesson ' + (idx + 1) + ' title</label><input type="text" class="lesson-title-input" value="' + (lesson.title || '').replace(/"/g, '&quot;') + '"></div>' +
      '<div class="field" style="flex:2 1 260px;"><label>Description</label>' +
        '<div class="rte-editable lesson-desc-editable" contenteditable="true" data-placeholder="What this lesson covers…" style="min-height:60px; font-size:13.5px; padding:10px 12px;">' + descHtml + '</div>' +
      '</div>' +
      '<button type="button" class="icon-btn remove-lesson-btn" title="Remove lesson"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg></button>' +
    '</div>'
  );
}

function renderLessonRows(lessons){
  const wrap = document.getElementById('lesson-edit-rows');
  wrap.innerHTML = lessons.map((l, i) => lessonRowHtml(l, i)).join('');
  wireRemoveButtons();
  trackLessonEditableFocus();
}

// Lets the ONE shared rich-text toolbar apply formatting to whichever
// description box the admin last clicked into — the chapter body editor and
// every lesson description all share the same toolbar rather than each
// needing its own.
let LAST_FOCUSED_EDITABLE = null;

function trackLessonEditableFocus(){
  document.querySelectorAll('.lesson-desc-editable').forEach((el) => {
    el.addEventListener('focus', () => { LAST_FOCUSED_EDITABLE = el; });
  });
}

function wireRemoveButtons(){
  document.querySelectorAll('.remove-lesson-btn').forEach((btn) => {
    btn.onclick = () => {
      const rows = document.querySelectorAll('.lesson-edit-row');
      if (rows.length <= 1) { alert('A chapter needs at least one lesson.'); return; }
      btn.closest('.lesson-edit-row').remove();
    };
  });
}

function loadChapterIntoForm(ch){
  document.getElementById('ed-num').value = ch.num;
  document.getElementById('ed-num').disabled = !IS_NEW_CHAPTER; // number is the doc ID — fixed once created
  document.getElementById('ed-title').value = ch.title || '';
  document.getElementById('ed-level').value = ch.level || 'foundation';
  document.getElementById('ed-dur').value = ch.dur || '';
  document.getElementById('ed-video').value = ch.video || '';

  const bodyEl = document.getElementById('ed-body');
  bodyEl.innerHTML = ch.bodyHtml || paragraphsToHtml(ch.paragraphs || ['']);
  bodyEl.setAttribute('data-placeholder', 'Write the chapter content here…');

  renderLessonRows(ch.lessons && ch.lessons.length ? ch.lessons : [{ title: '', desc: '' }]);

  document.getElementById('editor-heading').textContent = IS_NEW_CHAPTER ? 'New chapter' : ('Edit Chapter ' + ch.num);
  document.getElementById('editor-subheading').textContent = ch.title || 'Untitled';
}

function collectFormData(){
  const lessons = [];
  document.querySelectorAll('.lesson-edit-row').forEach((row) => {
    const title = row.querySelector('.lesson-title-input').value.trim();
    const descEl = row.querySelector('.lesson-desc-editable');
    const descHtml = descEl.innerHTML.trim();
    const descPlain = descEl.textContent.trim();
    if (title || descPlain) lessons.push({ title, desc: descPlain, descHtml: descHtml });
  });

  const bodyHtml = document.getElementById('ed-body').innerHTML;

  return {
    num: document.getElementById('ed-num').value.trim(),
    title: document.getElementById('ed-title').value.trim() || 'Untitled chapter',
    level: document.getElementById('ed-level').value,
    dur: document.getElementById('ed-dur').value.trim(),
    video: document.getElementById('ed-video').value.trim(),
    bodyHtml: bodyHtml,
    paragraphs: htmlToParagraphs(bodyHtml),
    lessons: lessons.length ? lessons : [{ title: '', desc: '', descHtml: '' }]
  };
}

function initRichTextToolbar(){
  const bodyEditable = document.getElementById('ed-body');
  LAST_FOCUSED_EDITABLE = bodyEditable; // default target before anything is focused
  bodyEditable.addEventListener('focus', () => { LAST_FOCUSED_EDITABLE = bodyEditable; });

  document.querySelectorAll('.rte-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = LAST_FOCUSED_EDITABLE || bodyEditable;
      target.focus();
      const cmd = btn.dataset.cmd;
      const value = btn.dataset.value || undefined;
      document.execCommand(cmd, false, value);
    });
  });
}

document.addEventListener('DOMContentLoaded', () => {
  initRichTextToolbar();

  guardAdminPage(() => {
    loadChapters().then(() => {
      const chNum = getQueryParam('ch');
      const isNew = getQueryParam('new') === '1';
      IS_NEW_CHAPTER = isNew;

      let ch;
      if (isNew) {
        const nums = CHAPTERS.map(c => parseInt(c.num, 10)).filter(n => !isNaN(n));
        const nextNum = String((nums.length ? Math.max(...nums) : 0) + 1).padStart(2, '0');
        ch = { num: nextNum, title: '', level: 'foundation', dur: '', video: '', bodyHtml: '', lessons: [{ title: '', desc: '' }] };
      } else {
        ch = CHAPTERS.find(c => c.num === chNum);
        if (!ch) {
          document.getElementById('editor-error').textContent = 'Chapter not found.';
          document.getElementById('editor-error').style.display = 'block';
          return;
        }
      }

      EDITING_NUM = ch.num;
      loadChapterIntoForm(ch);
    });
  });

  document.getElementById('add-lesson-btn').addEventListener('click', () => {
    const rows = document.querySelectorAll('.lesson-edit-row').length;
    document.getElementById('lesson-edit-rows').insertAdjacentHTML('beforeend', lessonRowHtml({ title: '', desc: '' }, rows));
    wireRemoveButtons();
  });

  document.getElementById('save-chapter-btn').addEventListener('click', () => {
    const errEl = document.getElementById('editor-error');
    const okEl = document.getElementById('editor-success');
    errEl.style.display = 'none';
    okEl.style.display = 'none';

    const data = collectFormData();
    if (!data.num) {
      errEl.textContent = 'Chapter number is required.';
      errEl.style.display = 'block';
      return;
    }

    const btn = document.getElementById('save-chapter-btn');
    btn.disabled = true;
    db.collection('chapters').doc(data.num).set(data)
      .then(() => loadChapters(true))
      .then(() => {
        okEl.textContent = 'Saved.';
        okEl.style.display = 'block';
        IS_NEW_CHAPTER = false;
        document.getElementById('ed-num').disabled = true;
        document.getElementById('editor-heading').textContent = 'Edit Chapter ' + data.num;
      })
      .catch((err) => {
        errEl.textContent = err.message || 'Could not save chapter.';
        errEl.style.display = 'block';
      })
      .finally(() => { btn.disabled = false; });
  });

  document.getElementById('delete-chapter-btn').addEventListener('click', () => {
    if (!EDITING_NUM) return;
    if (!confirm('Delete Chapter ' + EDITING_NUM + '? This removes it from the live curriculum immediately. This cannot be undone.')) return;
    db.collection('chapters').doc(EDITING_NUM).delete()
      .then(() => loadChapters(true))
      .then(() => { window.location.href = 'chapters-admin.html'; })
      .catch((err) => alert('Could not delete: ' + (err.message || err)));
  });
});
