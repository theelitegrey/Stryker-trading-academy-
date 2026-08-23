// Stryker Trading Academy — curriculum listing (courses.html)
// Depends on assets/chapters-data.js being loaded first.

function unlockLabel(index){
  if (index === 0) return '<span class="status-pill unlocked">Free</span>';
  return '<span class="status-pill locked">Unlocks Ch.' + String(index).padStart(2,'0') + '</span>';
}

function renderChapters(filterLevel){
  const container = document.getElementById('chapter-render-target');
  if (!container || typeof CHAPTERS === 'undefined') return;
  container.innerHTML = '';

  const order = ['foundation','intermediate','advanced'];
  order.forEach(level => {
    if (filterLevel !== 'all' && filterLevel !== level) return;
    const items = CHAPTERS.filter(c => c.level === level);
    if (!items.length) return;

    const heading = document.createElement('div');
    heading.className = 'part-heading';
    heading.innerHTML = '<span>' + PART_LABEL[level] + '</span><span class="part-count">' + items.length + ' chapters</span>';
    container.appendChild(heading);

    const list = document.createElement('div');
    list.className = 'chapter-list';
    list.style.marginBottom = '8px';

    items.forEach((ch) => {
      const globalIndex = parseInt(ch.num, 10) - 1;
      const el = document.createElement('div');
      el.className = 'chapter';
      el.setAttribute('data-expand', '');

      const lessonsHtml = ch.lessons.map((l, i) =>
        '<div class="lesson-item"><span class="lnum">0' + (i+1) + '</span><span>' + l.title + '</span></div>'
      ).join('');

      const preview = ch.paragraphs[0];

      el.innerHTML =
        '<div class="chapter-num">' + ch.num + '</div>' +
        '<div class="chapter-body">' +
          '<h3>' + ch.title + '</h3>' +
          '<p>' + preview.slice(0, 130) + (preview.length > 130 ? '…' : '') + '</p>' +
          '<div class="chapter-meta">' +
            '<span class="chapter-tag ' + LEVEL_TAG_CLASS[ch.level] + '">' + LEVEL_LABEL[ch.level] + '</span>' +
            '<span>' + ch.lessons.length + ' lessons</span><span>' + ch.dur + '</span>' +
          '</div>' +
          '<div class="chapter-detail"><div class="chapter-detail-inner">' +
            '<div><h5>What you\'ll learn</h5><p>' + preview + '</p>' +
              '<a class="btn btn-primary btn-sm" style="margin-top:14px; display:inline-flex;" href="chapter.html?ch=' + ch.num + '">Read full chapter &amp; watch video →</a></div>' +
            '<div><h5>Lessons</h5>' + lessonsHtml + '</div>' +
          '</div></div>' +
        '</div>' +
        '<div class="chapter-status" style="display:flex; align-items:center; gap:10px;">' +
          unlockLabel(globalIndex) +
          '<svg class="chapter-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg>' +
        '</div>';

      el.addEventListener('click', (e) => {
        if (e.target.closest('a,button')) return; // let real links navigate normally
        el.classList.toggle('expanded');
      });

      list.appendChild(el);
    });

    container.appendChild(list);
  });
}

document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.level-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.level-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderChapters(btn.dataset.level);
    });
  });
  renderChapters('all');
});
