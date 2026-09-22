// Chapters with no recording must show no player at all.
// (paths come from ./lib.js)
const { chromium, ROOT, BASE, launch } = require('./lib.js');
const stub = require('./stub.js');
const fs = require('fs');


const log = [];
const ok = (l, c, x) => log.push((c ? 'PASS  ' : 'FAIL  ') + l + (x ? '   ' + x : ''));

async function open(b, url) {
  const p = await b.newPage({ viewport: { width: 1280, height: 950 } });
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  await p.addInitScript(stub);
  await p.route(/^https?:\/\/(?!localhost)/, r => r.abort());
  await p.goto(url, { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(1200);
  p.__errs = errs;
  return p;
}

// visible = laid out on screen, not merely un-hidden: .video-note sets
// display:flex, which beats the browser's own [hidden] rule unless the CSS
// says otherwise. offsetParent catches that; the hidden attribute alone does not.
const shown = (sel) => `(() => { const el = document.querySelector(${JSON.stringify(sel)});
  return el ? !!(el.offsetParent || el.getClientRects().length) : null; })()`;

(async () => {
  // ---- 1. the shipped seed carries no placeholder clips ------------------
  const seed = fs.readFileSync(ROOT + '/assets/chapters-data.js', 'utf8');
  ok('seed has no Big Buck Bunny placeholder', !/commondatastorage\.googleapis\.com/.test(seed));
  ok('every seed chapter has an empty video field',
     (seed.match(/"video": ""/g) || []).length === (seed.match(/"video":/g) || []).length,
     (seed.match(/"video": ""/g) || []).length + ' empty of ' + (seed.match(/"video":/g) || []).length);

  const b = await launch();

  // ---- 2. chapter page with no video ------------------------------------
  let p = await open(b, BASE + '/chapter.html?ch=01');
  let r = await p.evaluate(`({
    frame: ${shown('.video-frame')},
    note: ${shown('#video-note')},
    tools: ${shown('#video-tools')},
    src: (document.getElementById('reader-video') || {}).getAttribute
       ? document.getElementById('reader-video').getAttribute('src') : 'no element',
    title: (document.getElementById('reader-title') || {}).textContent || ''
  })`);
  ok('chapter rendered', r.title.length > 0, r.title);
  ok('no-video chapter hides the player', r.frame === false, 'frame shown=' + r.frame);
  ok('no-video chapter hides the note', r.note === false, 'note shown=' + r.note);
  ok('no-video chapter builds no speed pills', r.tools === false || r.tools === null, 'tools shown=' + r.tools);
  ok('no src attribute left on the video element', !r.src, JSON.stringify(r.src));
  ok('no page errors', p.__errs.length === 0, p.__errs.join(' | '));

  // ---- 3. a chapter that DOES have one brings the player back -----------
  //
  // Same live page: this is the transition that the reader actually makes,
  // and the one a show/hide that only ever hides would fail.
  r = await p.evaluate(`(() => {
    renderChapterVideo({ num: '02', video: 'https://example.com/lesson.mp4' });
    return {
      frame: ${shown('.video-frame')},
      note: ${shown('#video-note')},
      tools: ${shown('#video-tools')},
      src: document.getElementById('reader-video').getAttribute('src')
    };
  })()`);
  ok('a real URL shows the player again', r.frame === true, 'frame shown=' + r.frame);
  ok('...and the note', r.note === true, 'note shown=' + r.note);
  ok('...and the speed pills', r.tools === true, 'tools shown=' + r.tools);
  ok('...pointing at the chapter URL', r.src === 'https://example.com/lesson.mp4', String(r.src));

  // ---- 4. and hides it again on the next chapter without one ------------
  r = await p.evaluate(`(() => {
    renderChapterVideo({ num: '03', video: '' });
    return { frame: ${shown('.video-frame')}, note: ${shown('#video-note')}, tools: ${shown('#video-tools')},
             src: document.getElementById('reader-video').getAttribute('src'),
             paused: document.getElementById('reader-video').paused };
  })()`);
  ok('going back to a chapter with no video hides it again', r.frame === false, 'frame shown=' + r.frame);
  ok('...pills hidden too', r.tools === false, 'tools shown=' + r.tools);
  ok('...src cleared', !r.src, JSON.stringify(r.src));
  ok('...playback stopped', r.paused === true);

  // ---- 5. the placeholder clip counts as no video -----------------------
  r = await p.evaluate(`({
    placeholder: chapterVideoUrl({ video: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4' }),
    blank: chapterVideoUrl({ video: '' }),
    missing: chapterVideoUrl({}),
    spaces: chapterVideoUrl({ video: '   ' }),
    real: chapterVideoUrl({ video: 'https://cdn.strykertrading.com/ch01.mp4' })
  })`);
  ok('the sample clip reads as no video', r.placeholder === '', JSON.stringify(r.placeholder));
  ok('an empty field reads as no video', r.blank === '');
  ok('a missing field reads as no video', r.missing === '');
  ok('whitespace reads as no video', r.spaces === '');
  ok('a real URL survives', r.real === 'https://cdn.strykertrading.com/ch01.mp4', r.real);
  // ---- 5b. the runtime goes with the recording --------------------------
  r = await p.evaluate(`(() => {
    const cells = Array.from(document.querySelectorAll('#reader-meta span')).map(s => s.textContent.trim());
    return { cells, runtime: cells.filter(t => /^\\d+ min$/.test(t)).length,
             read: cells.filter(t => /min read/.test(t)).length };
  })()`);
  ok('no-video chapter shows no runtime', r.runtime === 0, r.cells.join(' | '));
  ok('...but keeps the read estimate', r.read === 1, r.cells.join(' | '));

  await p.close();

  // ---- 6. the course list stops promising a video -----------------------
  p = await open(b, BASE + '/courses.html');
  r = await p.evaluate(`(() => {
    const links = Array.from(document.querySelectorAll('.chapter-detail a[href^="chapter.html"]'));
    return {
      n: links.length,
      watch: links.filter(a => /watch video/i.test(a.textContent)).length,
      read: links.filter(a => /^Read full chapter\\s*→$/.test(a.textContent.trim())).length,
      sample: links.length ? links[0].textContent.trim() : '',
      runtimes: Array.from(document.querySelectorAll('.chapter-meta span')).filter(s => /^\\d+ min$/.test(s.textContent.trim())).length
    };
  })()`);
  ok('course cards rendered', r.n > 0, r.n + ' cards');
  ok('no card shows a runtime', r.runtimes === 0, r.runtimes + ' runtime chips left');
  ok('no card promises a video', r.watch === 0, r.watch + ' still say "watch video"');
  ok('every card offers the read instead', r.read === r.n, r.read + '/' + r.n + ' — sample: ' + r.sample);
  ok('no page errors on courses', p.__errs.length === 0, p.__errs.join(' | '));
  await p.close();

  await b.close();
  const fails = log.filter(l => l.startsWith('FAIL')).length;
  console.log(log.join('\n'));
  console.log('\n' + (log.length - fails) + '/' + log.length + ' passed');
  process.exit(fails ? 1 : 0);
})();
