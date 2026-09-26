// frames + behaviour tests: node frames.mjs <base> <outdir>
import { launch, openPage } from './mv2.mjs';
const [base, out] = process.argv.slice(2);
const url = base + '/model.html?id=fvg-model-b';
const b = await launch();
const res = [];
const ok = (name, cond, extra) => { res.push((cond ? 'PASS ' : 'FAIL ') + name + (extra ? '  ' + extra : '')); };
try {
  // 1. every frame, final state (reduced motion = instant), 390 night + 1440 day
  for (const [w, theme] of [[390, 'night'], [1440, 'day']]) {
    const { ctx, page, errors } = await openPage(b, url, { w, h: w < 700 ? 844 : 900, theme, reduced: true });
    const sp = page.locator('.sp');
    await sp.scrollIntoViewIfNeeded();
    await page.waitForTimeout(1500);
    const auto = await page.evaluate(() => document.querySelector('.sp-stepno').textContent + '|' + document.querySelector('.sp').classList.contains('is-playing'));
    ok(`reduced ${w}: no autoplay`, auto === 'Step 1 of 8|false', auto);
    for (let i = 0; i < 8; i++) {
      if (i) await page.click('.sp-next');
      await page.waitForTimeout(80);
      if (i === 0 || i === 3 || i === 5 || i === 7) await sp.screenshot({ path: `${out}/frame${i + 1}-${w}-${theme}.png` });
    }
    const anims = await page.evaluate(() => [...document.querySelectorAll('.sp-svg *')].filter(e => getComputedStyle(e).animationName !== 'none').length);
    ok(`reduced ${w}: no animations running`, anims === 0, 'animated nodes=' + anims);
    const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth, spw: document.querySelector('.sp').scrollWidth, spcw: document.querySelector('.sp').clientWidth }));
    ok(`${w}: no horizontal overflow`, m.sw <= m.iw && m.spw <= m.spcw, JSON.stringify(m));
    ok(`${w} ${theme}: console clean`, errors.filter(e => !/ERR_FAILED/.test(e)).length === 0, JSON.stringify(errors));
    // touch targets
    const tt = await page.evaluate(() => [...document.querySelectorAll('.sp-btn,.sp-speed button')].map(e => Math.round(e.getBoundingClientRect().height)).join(','));
    ok(`${w}: control heights`, tt.split(',').every(h => +h >= 32), tt);
    await ctx.close();
  }

  // 2. keyboard + speed + scrubber, desktop night, motion on
  {
    const { ctx, page } = await openPage(b, url, { w: 1440, h: 900, theme: 'night' });
    await page.locator('.sp').scrollIntoViewIfNeeded();
    await page.waitForTimeout(400);
    const playing = await page.evaluate(() => document.querySelector('.sp').classList.contains('is-playing'));
    ok('autoplay when in view', playing);
    await page.focus('.sp');
    await page.keyboard.press(' ');
    const paused = await page.evaluate(() => !document.querySelector('.sp').classList.contains('is-playing'));
    ok('space pauses', paused);
    await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight');
    const s3 = await page.textContent('.sp-stepno');
    ok('arrow right x2 -> step 3', s3 === 'Step 3 of 8', s3);
    await page.keyboard.press('ArrowLeft');
    ok('arrow left -> step 2', (await page.textContent('.sp-stepno')) === 'Step 2 of 8');
    await page.keyboard.press('End');
    ok('End -> step 8', (await page.textContent('.sp-stepno')) === 'Step 8 of 8');
    ok('play button says replay at end', (await page.getAttribute('.sp-play', 'aria-label')) === 'Replay from the start');
    await page.keyboard.press('Home');
    ok('Home -> step 1', (await page.textContent('.sp-stepno')) === 'Step 1 of 8');
    await page.click('.sp-speed [data-speed="2"]');
    ok('speed 2x pressed', (await page.getAttribute('.sp-speed [data-speed="2"]', 'aria-pressed')) === 'true');
    await page.locator('.sp-scrub').fill('5');
    ok('scrubber -> step 6', (await page.textContent('.sp-stepno')) === 'Step 6 of 8');
    // play at 2x from 6 -> should reach 8 within ~9s
    await page.click('.sp-play');
    await page.waitForTimeout(9000);
    const end = await page.evaluate(() => document.querySelector('.sp-stepno').textContent + '|' + document.querySelector('.sp').classList.contains('is-playing'));
    ok('2x play runs to the end and stops', end === 'Step 8 of 8|false', end);
    // off-screen pause
    await page.click('.sp-play');           // replay from start
    await page.waitForTimeout(300);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(600);
    const off = await page.evaluate(() => document.querySelector('.sp').classList.contains('is-playing'));
    ok('pauses off screen', off === false);
    await page.locator('.sp').scrollIntoViewIfNeeded();
    await page.waitForTimeout(600);
    ok('resumes when back on screen', await page.evaluate(() => document.querySelector('.sp').classList.contains('is-playing')));
    await ctx.close();
  }

  // 3. mid-sequence tween capture + swipe, 390 night, motion on
  {
    const { ctx, page, errors } = await openPage(b, url, { w: 390, h: 844, theme: 'night' });
    await page.evaluate(() => document.querySelector('.sp').scrollIntoView({ block: 'center' }));
    await page.waitForTimeout(300);
    await page.click('.sp-play');                 // user pause
    await page.click('.sp-next'); await page.click('.sp-next');   // to step 3 (reveals 4 candles with tween)
    await page.waitForTimeout(250);
    const mid = await page.evaluate(() => [...document.querySelectorAll('.sp-svg .sp-new')].length);
    ok('forward step tweens new items', mid > 0, 'sp-new=' + mid);
    // swipe via touch events
    const box = await page.locator('.sp-chart').boundingBox();
    const cdp = await ctx.newCDPSession(page);
    const y = box.y + box.height / 2;
    const swipe = async (x1, x2) => {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x1, y }] });
      for (let s = 1; s <= 6; s++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x1 + (x2 - x1) * s / 6, y }] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    };
    await swipe(box.x + box.width * 0.8, box.x + box.width * 0.2);
    ok('swipe left -> next (step 4)', (await page.textContent('.sp-stepno')) === 'Step 4 of 8', await page.textContent('.sp-stepno'));
    await swipe(box.x + box.width * 0.2, box.x + box.width * 0.8);
    ok('swipe right -> prev (step 3)', (await page.textContent('.sp-stepno')) === 'Step 3 of 8');
    ok('390 motion console clean', errors.filter(e => !/ERR_FAILED/.test(e)).length === 0, JSON.stringify(errors));
    await ctx.close();
  }

  // 4. model without storyboard: no player, article intact
  {
    const { ctx, page } = await openPage(b, base + '/model.html?id=orb-model-a', { w: 390, h: 844 });
    const r = await page.evaluate(() => ({ hidden: document.getElementById('model-player-slot').hidden, kids: document.getElementById('model-player-slot').children.length, body: document.getElementById('model-body').textContent.length }));
    ok('no storyboard: slot hidden + empty', r.hidden && r.kids === 0, JSON.stringify(r));
    ok('no storyboard: article rendered', r.body > 200);
    await ctx.close();
  }

  // 5. invalid storyboard: injected broken data -> hidden, article intact; valid mount/unmount cycle
  {
    const { ctx, page, errors } = await openPage(b, url, { w: 390, h: 844 });
    const r = await page.evaluate(() => {
      const slot = document.getElementById('model-player-slot');
      const outp = {};
      const bad = [null, {}, { candles: 'x', frames: [] }, { candles: [{ o: 1, h: 0, l: 2, c: 1 }, 1, 2, 3, 4], frames: [{}] },
        { candles: Array.from({ length: 6 }, () => ({ o: 1, h: 2, l: 0, c: 1 })), frames: [] }];
      outp.bad = bad.map((sb) => { mountSetupPlayer(slot, { name: 'x', storyboard: sb }); return slot.hidden && slot.children.length === 0; });
      // label with markup is escaped
      mountSetupPlayer(slot, { name: 'x', storyboard: { candles: Array.from({ length: 6 }, () => ({ o: 1, h: 2, l: 0, c: 1 })), frames: [{ caption: '<img src=x onerror=alert(1)>', add: [{ type: 'level', id: 'a', price: 1, label: '<b>x</b>' }] }] } });
      outp.escaped = !slot.querySelector('.sp img, .sp b') && slot.querySelector('.sp-cap-text').textContent.startsWith('<img');
      // render the real model again (re-render path)
      const m = MODELS.find((x) => x.id === 'fvg-model-b'); renderModel(m);
      outp.reRender = !slot.hidden && slot.querySelectorAll('.sp').length === 1;
      outp.body = document.getElementById('model-body').textContent.length;
      return outp;
    });
    ok('invalid storyboards all hide the slot', r.bad.every(Boolean), JSON.stringify(r.bad));
    ok('text in labels/captions is escaped', r.escaped);
    ok('re-render leaves exactly one player', r.reRender);
    ok('article intact after all that', r.body > 200);
    ok('no page errors from bad data', errors.filter(e => /PAGEERROR/.test(e)).length === 0, JSON.stringify(errors));
    await ctx.close();
  }

  // 6. JS failure: player script 404 -> page still renders article, no player
  {
    const { ctx } = await openPage(b, base + '/404.html', { w: 390, h: 844 });
    await ctx.route(/setup-player\.js/, (r) => r.fulfill({ status: 500, body: 'x' }));
    const page = await ctx.newPage();
    await page.goto(url, { waitUntil: 'load' }); await page.waitForTimeout(800);
    const r = await page.evaluate(() => ({ hidden: document.getElementById('model-player-slot').hidden, body: document.getElementById('model-body').textContent.length, steps: document.querySelectorAll('.mdl-step').length }));
    ok('player script missing: slot hidden, article + steps render', r.hidden && r.body > 200 && r.steps === 7, JSON.stringify(r));
    await ctx.close();
  }
} finally { await b.close(); }
console.log(res.join('\n'));
console.log(res.filter(x => x.startsWith('FAIL')).length ? 'SOME FAILED' : 'ALL PASS', res.length);
