// Feature page check (FEATA, 19 Nov 2026): full-page + per-section shots at 1440 and 390 (412 too), dark and light,
// page errors, horizontal overflow, phone page height, and the ALIGNMENT GATE measurements for the template.
//   python3 -m http.server 8097 &   (repo root)
//   NODE_PATH=<dir with playwright-core> tools/chrome-slot.sh node tools/feature-pages/verify.js <outRoot> [page ...]
// Prints one JSON line per page/viewport/theme; exit 1 if any check fails.
const fs = require('fs');
const path = require('path');
const { launch } = require('../tests/lib.js');
const stub = require('../tests/stub.js');
const BASE = process.env.FP_BASE || 'http://127.0.0.1:8097';
const OUT = process.argv[2] || '/tmp/fpg-out';
const PAGES = process.argv.slice(3).length ? process.argv.slice(3) : ['gex', 'orderflow'];
const SECS = ['top', 'problem', 'tour', 'more', 'how', 'list', 'related', 'faq', 'end-h'];

(async () => {
  const b = await launch();
  let bad = 0;
  for (const pg of PAGES) {
    for (const [w, h] of [[1440, 900], [390, 844], [412, 915]]) {
      for (const theme of ['dark', 'light']) {
        if (w === 412 && theme === 'light') continue;
        const dir = path.join(OUT, pg); fs.mkdirSync(dir, { recursive: true });
        const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
        await ctx.addInitScript(stub);
        await ctx.addInitScript((t) => { try {
          localStorage.setItem('tz_consent', JSON.stringify({ v: 1, essential: true, analytics: false, at: new Date().toISOString() }));
          if (t === 'light') localStorage.setItem('stryker_theme', 'day'); else localStorage.removeItem('stryker_theme');
        } catch (e) {} }, theme);
        await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
        const p = await ctx.newPage();
        const errs = [];
        p.on('pageerror', (e) => errs.push(String(e.message || e)));
        await p.goto(`${BASE}/features/${pg}.html`, { waitUntil: 'load' });
        await p.waitForTimeout(600);
        await p.evaluate(() => document.querySelectorAll('img[loading=lazy]').forEach((i) => { i.loading = 'eager'; }));
        // scroll through so lazy images load and reveals fire
        const H = await p.evaluate(() => document.documentElement.scrollHeight);
        for (let y = 0; y < H; y += Math.round(h * 0.7)) { await p.evaluate((y) => scrollTo(0, y), y); await p.waitForTimeout(120); }
        await p.evaluate(() => scrollTo(0, 0)); await p.waitForTimeout(1700);
        await p.waitForFunction(() => [...document.querySelectorAll('main img')].every((i) => !i.getClientRects().length || i.closest('.fpg-bento, .fpg-vals') || (i.complete && i.naturalWidth)), null, { timeout: 8000 }).catch(() => {});
        const tag = `${w}-${theme}`;
        // step story at desktop: scroll to the 3rd step and record the active slide
        let story = null;
        if (w === 1440) {
          story = await p.evaluate(async () => {
            const s = document.querySelectorAll('.fpg-step')[2]; if (!s) return null;
            const r = s.getBoundingClientRect(); scrollTo(0, scrollY + r.top + r.height / 2 - innerHeight / 2);
            await new Promise((f) => setTimeout(f, 900));
            const on = [...document.querySelectorAll('.fpg-slide')].findIndex((x) => x.classList.contains('is-on'));
            const st = [...document.querySelectorAll('.fpg-step')].findIndex((x) => x.classList.contains('is-on'));
            const line = getComputedStyle(document.querySelector('.fpg-line')).getPropertyValue('--fpg-p') || document.querySelector('.fpg-line').style.getPropertyValue('--fpg-p');
            const stage = document.querySelector('.fpg-step-stage').getBoundingClientRect();
            return { slide: on, step: st, line, stageTop: Math.round(stage.top), stageVisible: stage.top >= 0 && stage.bottom <= innerHeight };
          });
          await p.screenshot({ path: path.join(dir, `steps-step3-${tag}.png`) });
          await p.evaluate(() => scrollTo(0, 0)); await p.waitForTimeout(300);
        }
        const m = await p.evaluate(() => {
          const R = (e) => e.getBoundingClientRect();
          const out = { overflowX: document.documentElement.scrollWidth - innerWidth, height: document.documentElement.scrollHeight, issues: [] };
          const push = (s) => { if (out.issues.length < 25) out.issues.push(s); };
          // empty / broken images
          document.querySelectorAll('main img').forEach((i) => { if (!i.getClientRects().length || i.closest('.fpg-bento, .fpg-vals')) return; if (!i.complete || !i.naturalWidth) push('img not loaded ' + i.getAttribute('src')); });
          // elements wider than the viewport
          document.querySelectorAll('main *').forEach((e) => { const r = R(e); if (r.width && (r.right > innerWidth + 1 || r.left < -1) && getComputedStyle(e).position !== 'fixed' && !e.closest('.fpg-ix-nav, .fpg-hero-media, .fpg-slide, .fpg-bento, .fpg-vals')) push('overflow ' + e.className + ' ' + Math.round(r.left) + '..' + Math.round(r.right)); });
          // text clipped by its own box
          document.querySelectorAll('main h1, main h2, main h3, main p, main b, main span, main summary, main a.btn').forEach((e) => {
            if (e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflow !== 'visible' && e.clientWidth) push('clipped ' + e.tagName + ' ' + e.textContent.slice(0, 30));
          });
          // ALIGNMENT: buttons in a CTA row share one vertical centre; text centred in pills/buttons; icons centred
          const cen = (r) => r.top + r.height / 2;
          document.querySelectorAll('.fpg-cta').forEach((row) => {
            const bs = [...row.querySelectorAll('.btn')]; if (bs.length < 2) return;
            const rs = bs.map(R); if (rs[0].top === rs[1].top && Math.abs(cen(rs[0]) - cen(rs[1])) > 1) push('cta centres differ');
            bs.forEach((bt) => { const r = R(bt), rg = document.createRange(); rg.selectNodeContents(bt); const t = rg.getBoundingClientRect();
              const dl = t.left - r.left, dr = r.right - t.right, dt = t.top - r.top, db = r.bottom - t.bottom;
              if (Math.abs(dl - dr) > 1.5 || Math.abs(dt - db) > 1.5) push('btn pad ' + bt.textContent + ' ' + [dl, dr, dt, db].map(Math.round)); });
          });
          document.querySelectorAll('.fpg-chip, .fpg-tag, .fpg-count, .fpg-sn').forEach((e) => {
            const r = R(e), rg = document.createRange(); rg.selectNodeContents(e); const t = rg.getBoundingClientRect();
            if (!r.width) return;
            const dt = t.top - r.top, db = r.bottom - t.bottom;
            if (Math.abs(dt - db) > 1.5) push('vpad ' + e.className + ' ' + Math.round(dt) + '/' + Math.round(db));
            if (!e.classList.contains('fpg-chip')) { const dl = t.left - r.left, dr = r.right - t.right; if (Math.abs(dl - dr) > 1.5) push('hpad ' + e.className + ' ' + Math.round(dl) + '/' + Math.round(dr)); }
          });
          document.querySelectorAll('.fpg-chip').forEach((e) => { const r = R(e), i = R(e.querySelector('img')); if (Math.abs(cen(r) - cen(i)) > 1) push('chip icon off-centre'); });
          document.querySelectorAll('.fpg-arrow span, .fpg-card h3 .ci, .fpg-val > .ci').forEach((e) => {
            const r = R(e), s = e.querySelector ? (e.querySelector('svg') || e) : e; const k = R(s);
            if (s !== e && (Math.abs(cen(r) - cen(k)) > 1 || Math.abs((r.left + r.width / 2) - (k.left + k.width / 2)) > 1)) push('icon off-centre');
          });
          document.querySelectorAll('.fpg-card h3, .fpg-relc').forEach((row) => {
            const kids = [...row.children].filter((c) => R(c).height); if (kids.length < 2) return;
            const c0 = cen(R(kids[0])); kids.slice(1).forEach((c) => { if (Math.abs(cen(R(c)) - c0) > 1.5 && row.classList.contains('fpg-card') === false && c.tagName !== 'DIV') push('row centre ' + row.className); });
          });
          // consistent gaps between sibling cards (bento / vals / rel)
          ['.fpg-bento', '.fpg-vals', '.fpg-rel', '.fpg-faq'].forEach((s) => document.querySelectorAll(s).forEach((g) => {
            const gs = getComputedStyle(g); out[s + ' gap'] = gs.rowGap + '/' + gs.columnGap;
          }));
          // numbers tabular
          out.tabular = [...document.querySelectorAll('.fpg-sn, .fpg-count, .fpg-ix-nav a span')].every((e) => getComputedStyle(e).fontVariantNumeric.includes('tabular-nums'));
          out.count = (document.querySelector('[data-fpg-count]') || {}).textContent;
          out.countReal = document.querySelectorAll('.fpg-ix-group li').length + ' features · ' + document.querySelectorAll('.fpg-ix-group').length + ' groups';
          out.h1Font = getComputedStyle(document.querySelector('.fpg-h1')).fontFamily.split(',')[0];
          out.heroTilt = getComputedStyle(document.querySelector('.fpg-hero-media .fpg-device')).transform !== 'none';
          out.ids = ['top', 'tour', 'more', 'how', 'list', 'faq', 'sx-f-liquidity'].filter((id) => document.getElementById(id)).join(',');
          return out;
        });
        // per-section + full-page shots
        await p.screenshot({ path: path.join(dir, `full-${tag}.png`), fullPage: true });
        // section shots: hide the fixed app bars so they do not get stitched into tall element captures
        await p.addStyleTag({ content: '.mobile-topnav, .appnav-dock, #site-nav, .cookie-notice, [class*=cookie]{ visibility:hidden !important; }' });
        for (const id of SECS) {
          const el = await p.$(id === 'end-h' ? '.fpg-final' : '#' + id);
          if (!el) continue;
          await el.scrollIntoViewIfNeeded(); await p.waitForTimeout(250);
          await el.screenshot({ path: path.join(dir, `sec-${id}-${tag}.png`) });
        }
        const swipe = await p.evaluate(() => ['.fpg-bento', '.fpg-vals'].map((s) => { const e = document.querySelector(s); return e ? (e.scrollWidth > e.clientWidth ? s + ' swipes' : s + ' grid') : ''; }).join(', '));
        m.swipe = swipe;
        const fail = errs.length || m.overflowX > 0 || m.issues.length || m.count !== m.countReal || (w < 500 && (m.height < 5000 || m.height > 8000));
        if (fail) bad++;
        console.log(JSON.stringify({ pg, tag, ok: !fail, errs, story, ...m }));
        await ctx.close();
      }
    }
  }
  await b.close();
  process.exit(bad ? 1 : 0);
})();
