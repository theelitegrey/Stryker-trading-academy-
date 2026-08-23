// Stryker Trading Academy — chapter reader (chapter.html)
// Depends on assets/chapters-data.js being loaded first.
// Progress is persisted in localStorage on this device (no backend/database yet).

function getChapterIndexFromQuery(){
  const params = new URLSearchParams(window.location.search);
  const chNum = params.get('ch') || '01';
  let idx = CHAPTERS.findIndex(c => c.num === chNum);
  if (idx === -1) idx = 0;
  return idx;
}

function loadProgress(){
  try {
    const raw = localStorage.getItem('stryker_progress');
    if (raw) return JSON.parse(raw);
  } catch(e) {}
  return { completedLessons: [], completedChapters: [] };
}
function saveProgress(){
  try {
    localStorage.setItem('stryker_progress', JSON.stringify({
      completedLessons: Array.from(completedLessonsSet),
      completedChapters: Array.from(completedChaptersSet)
    }));
  } catch(e) {}
}

const _progress = loadProgress();
const completedLessonsSet = new Set(_progress.completedLessons);
const completedChaptersSet = new Set(_progress.completedChapters);

let CURRENT_INDEX = 0;

function buildTOC(activeIndex){
  const toc = document.getElementById('reader-toc-list');
  if (!toc) return;
  toc.innerHTML = '';
  const parts = [
    { key: 'foundation', label: 'Part I — Foundation' },
    { key: 'intermediate', label: 'Part II — Intermediate' },
    { key: 'advanced', label: 'Part III — Advanced' }
  ];
  parts.forEach(part => {
    const heading = document.createElement('div');
    heading.className = 'toc-part';
    heading.textContent = part.label;
    toc.appendChild(heading);

    CHAPTERS.forEach((ch, i) => {
      if (ch.level !== part.key) return;
      const item = document.createElement('a');
      item.href = 'chapter.html?ch=' + ch.num;
      item.className = 'toc-item' + (i === activeIndex ? ' current' : '') + (completedChaptersSet.has(ch.num) ? ' done' : '');
      item.innerHTML =
        '<span class="toc-num">' + ch.num + '</span>' +
        '<span>' + ch.title + '</span>' +
        '<svg class="toc-check" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M20 6L9 17l-5-5"/></svg>';
      toc.appendChild(item);
    });
  });
}

function renderReader(){
  CURRENT_INDEX = getChapterIndexFromQuery();
  const ch = CHAPTERS[CURRENT_INDEX];
  if (!ch) return;

  document.title = 'Chapter ' + ch.num + ' — ' + ch.title + ' | Stryker Trading Academy';
  document.getElementById('reader-crumb-title').textContent = 'Chapter ' + ch.num;
  document.getElementById('reader-title').textContent = ch.title;

  const metaWrap = document.getElementById('reader-meta');
  metaWrap.innerHTML =
    '<span class="chapter-tag ' + LEVEL_TAG_CLASS[ch.level] + '">' + LEVEL_LABEL[ch.level] + '</span>' +
    '<span style="font-family:var(--font-mono); font-size:11.5px; color:var(--ink-3);">' + ch.lessons.length + ' lessons</span>' +
    '<span style="font-family:var(--font-mono); font-size:11.5px; color:var(--ink-3);">' + ch.dur + '</span>';

  const video = document.getElementById('reader-video');
  video.src = ch.video;
  video.load();

  const body = document.getElementById('reader-body');
  body.innerHTML = ch.paragraphs.map(p => '<p>' + p + '</p>').join('');

  const lessonsWrap = document.getElementById('reader-lessons');
  lessonsWrap.innerHTML = '';
  ch.lessons.forEach((lesson, li) => {
    const lid = ch.num + '-' + li;
    const block = document.createElement('div');
    block.className = 'lesson-block';
    block.innerHTML =
      '<div class="lesson-check' + (completedLessonsSet.has(lid) ? ' done' : '') + '" data-lid="' + lid + '">' +
        '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M20 6L9 17l-5-5"/></svg>' +
      '</div>' +
      '<div><h4>' + (li+1) + '. ' + lesson.title + '</h4><p>' + lesson.desc + '</p></div>';
    block.querySelector('.lesson-check').addEventListener('click', function(){
      this.classList.toggle('done');
      if (this.classList.contains('done')) completedLessonsSet.add(lid);
      else completedLessonsSet.delete(lid);
      saveProgress();
      updateChapterProgressUI(ch);
    });
    lessonsWrap.appendChild(block);
  });

  updateChapterProgressUI(ch);

  // prev / next — real links now, not JS-only navigation
  const prevBtn = document.getElementById('reader-prev');
  const nextBtn = document.getElementById('reader-next');
  if (CURRENT_INDEX > 0) {
    const p = CHAPTERS[CURRENT_INDEX - 1];
    prevBtn.style.visibility = 'visible';
    prevBtn.href = 'chapter.html?ch=' + p.num;
    prevBtn.querySelector('b').textContent = p.num + ' — ' + p.title;
  } else {
    prevBtn.style.visibility = 'hidden';
  }
  if (CURRENT_INDEX < CHAPTERS.length - 1) {
    const n = CHAPTERS[CURRENT_INDEX + 1];
    nextBtn.style.visibility = 'visible';
    nextBtn.href = 'chapter.html?ch=' + n.num;
    nextBtn.querySelector('b').textContent = n.num + ' — ' + n.title;
  } else {
    nextBtn.style.visibility = 'hidden';
  }

  buildTOC(CURRENT_INDEX);
  window.scrollTo({ top: 0 });
}

function updateChapterProgressUI(ch){
  const total = ch.lessons.length;
  let done = 0;
  ch.lessons.forEach((l, li) => { if (completedLessonsSet.has(ch.num + '-' + li)) done++; });
  const fill = document.getElementById('reader-progress-fill');
  const label = document.getElementById('reader-progress-label');
  if (fill) fill.style.width = Math.round((done/total)*100) + '%';
  if (label) label.textContent = done + ' / ' + total + ' lessons complete';

  const markBtn = document.getElementById('reader-mark-complete');
  if (done === total) {
    completedChaptersSet.add(ch.num);
    if (markBtn){ markBtn.textContent = 'Chapter complete ✓'; markBtn.classList.add('btn-ghost'); markBtn.classList.remove('btn-primary'); }
  } else {
    completedChaptersSet.delete(ch.num);
    if (markBtn){ markBtn.textContent = 'Mark all lessons complete'; markBtn.classList.add('btn-primary'); markBtn.classList.remove('btn-ghost'); }
  }
  saveProgress();
  buildTOC(CURRENT_INDEX); // keep sidebar checkmarks live
}

function markAllComplete(){
  const ch = CHAPTERS[CURRENT_INDEX];
  ch.lessons.forEach((l, li) => completedLessonsSet.add(ch.num + '-' + li));
  saveProgress();
  renderReader();
}

document.addEventListener('DOMContentLoaded', renderReader);
