// node sb.mjs <base> <outdir>: models list (11) + silver bullet player pass
import { launch, openPage } from './mv2.mjs';
const [base, out] = process.argv.slice(2);
const b = await launch();
const res = [];
const ok = (n, c, x) => res.push((c ? 'PASS ' : 'FAIL ') + n + (x ? '  ' + x : ''));
const clean = (e) => e.filter((x) => !/ERR_FAILED/.test(x));
try {
  // models list
  for (const [w, h, theme] of [[390, 844, 'night'], [1440, 900, 'day']]) {
    const { ctx, page, errors } = await openPage(b, base + '/models.html', { w, h, theme });
    await page.waitForTimeout(1200);
    const r = await page.evaluate(() => ({
      cards: document.querySelectorAll('.mdl-card, [data-model-id], a[href*="model.html?id="]').length,
      links: [...new Set([...document.querySelectorAll('a[href*="model.html?id="]')].map((a) => a.getAttribute('href')))].length,
      chips: [...document.querySelectorAll('.mdl-chip')].map((c) => c.textContent.trim()),
      sw: document.documentElement.scrollWidth, iw: innerWidth,
    }));
    ok(`list ${w} ${theme}: 11 model links`, r.links === 11, `links=${r.links} chips=${JSON.stringify(r.chips)}`);
    ok(`list ${w}: no overflow`, r.sw <= r.iw, `${r.sw}/${r.iw}`);
    ok(`list ${w}: console clean`, clean(errors).length === 0, JSON.stringify(clean(errors)));
    await page.screenshot({ path: `${out}/list-${w}-${theme}.png`, fullPage: true });
    // filter chip: click one category, count, then All
    const chip = page.locator('.mdl-chip').nth(3);
    const label = (await chip.textContent()).trim();
    await chip.click(); await page.waitForTimeout(300);
    const n = await page.evaluate(() => [...new Set([...document.querySelectorAll('a[href*="model.html?id="]')].map((a) => a.getAttribute('href')))].length);
    ok(`list ${w}: filter "${label}" narrows`, n >= 1 && n < 11 && label.endsWith(String(n)), 'shown=' + n);
    await page.locator('.mdl-chip').first().click(); await page.waitForTimeout(300);
    await ctx.close();
  }
  // silver bullet player
  const url = base + '/model.html?id=silver-bullet-model';
  for (const [w, h, theme, reduced] of [[390, 844, 'night', false], [390, 844, 'day', false], [1440, 900, 'night', false], [1440, 900, 'day', false], [390, 844, 'night', true]]) {
    const tag = `${w}-${theme}${reduced ? '-reduced' : ''}`;
    const { ctx, page, errors } = await openPage(b, url, { w, h, theme, reduced });
    await page.evaluate(() => { document.documentElement.style.scrollBehavior = 'auto'; const r = document.querySelector('.sp').getBoundingClientRect(); window.scrollTo(0, scrollY + r.top - 84); });
    await page.waitForTimeout(1500);
    const s1 = await page.evaluate(() => ({ step: document.querySelector('.sp-stepno').textContent, playing: document.querySelector('.sp').classList.contains('is-playing'),
      badge: document.querySelector('.sp-badge').textContent, title: document.querySelector('.sp-title').textContent,
      sw: document.documentElement.scrollWidth, iw: innerWidth, h1: document.getElementById('model-title').textContent,
      priceInLabels: [...document.querySelectorAll('.sp-lab')].some((t) => /\d{3,}/.test(t.textContent)) }));
    ok(`sb ${tag}: autoplay ${reduced ? 'off' : 'on'}`, s1.playing === !reduced, JSON.stringify({ step: s1.step, playing: s1.playing }));
    ok(`sb ${tag}: badge + title`, s1.badge === 'Illustrative example' && s1.h1 === 'ICT Silver Bullet', s1.title);
    ok(`sb ${tag}: no overflow`, s1.sw <= s1.iw, `${s1.sw}/${s1.iw}`);
    ok(`sb ${tag}: no prices in chart labels`, !s1.priceInLabels);
    if (!s1.playing) {} else { await page.click('.sp-play'); }
    await page.focus('.sp');
    const seen = [];
    for (let i = 0; i < 8; i++) {
      if (i) await page.keyboard.press('ArrowRight');
      await page.waitForTimeout(reduced ? 60 : 1100);
      seen.push(await page.textContent('.sp-stepno'));
      if ((i === 3 && !reduced) || (i === 7)) await page.locator('.sp').screenshot({ path: `${out}/sb-${tag}-step${i + 1}.png` });
    }
    ok(`sb ${tag}: steps 1..8 by keyboard`, seen.join(',') === [1, 2, 3, 4, 5, 6, 7, 8].map((n) => `Step ${n} of 8`).join(','), seen.at(-1));
    if (reduced) {
      const anims = await page.evaluate(() => [...document.querySelectorAll('.sp-svg *')].filter((e) => getComputedStyle(e).animationName !== 'none').length);
      ok(`sb ${tag}: no animation`, anims === 0, 'anims=' + anims);
    }
    ok(`sb ${tag}: console clean`, clean(errors).length === 0, JSON.stringify(clean(errors)));
    await ctx.close();
  }
} finally { await b.close(); }
console.log(res.join('\n'));
console.log(res.some((x) => x.startsWith('FAIL')) ? 'SOME FAILED' : 'ALL PASS', res.length);
