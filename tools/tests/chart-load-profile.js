// Charts page load profile: script count/bytes by origin, render-blocking scripts, long tasks during
// load, time to first chart, image bytes, and JS coverage (unused bytes) per file.
//   CHART_BASE=https://tradezoro.com node tools/tests/chart-load-profile.js [--phone]
// Run under flock /tmp/stryker-chrome.lock.
const { launch } = require('./lib.js');
const BASE = process.env.CHART_BASE || 'https://tradezoro.com';
const PHONE = process.argv.includes('--phone');
(async () => {
  const b = await launch({ args: ['--no-sandbox', '--disable-dev-shm-usage', '--js-flags=--max-old-space-size=768'] });
  const ctx = await b.newContext(PHONE ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true } : { viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(() => { window.__lt = []; try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt.push([e.startTime, e.duration]); }).observe({ type: 'longtask', buffered: true }); } catch (e) {} });
  const p = await ctx.newPage();
  await p.coverage.startJSCoverage({ resetOnNavigation: false });
  const t0 = Date.now();
  await p.goto(BASE + (BASE.includes('localhost') ? '/charts.html' : '/charts'), { waitUntil: 'domcontentloaded' });
  const dcl = Date.now() - t0;
  await p.waitForFunction(() => window.STRYKER_VELA && window.STRYKER_VELA.chart && window.STRYKER_VELA.chart.orchestrator.rawBars.length > 0, null, { timeout: 60000 });
  const chart = Date.now() - t0;
  await p.waitForTimeout(5000);
  const cov = await p.coverage.stopJSCoverage();
  const r = await p.evaluate(() => {
    const res = performance.getEntriesByType('resource');
    const by = {};
    for (const e of res) {
      const k = e.initiatorType + ' ' + new URL(e.name).host;
      by[k] = by[k] || { n: 0, xfer: 0, dec: 0 };
      by[k].n++; by[k].xfer += e.transferSize; by[k].dec += e.decodedBodySize;
    }
    const nav = performance.getEntriesByType('navigation')[0];
    const fcp = (performance.getEntriesByName('first-contentful-paint')[0] || {}).startTime;
    const blocking = res.filter((e) => e.renderBlockingStatus === 'blocking').map((e) => e.name.replace(location.origin, '').slice(0, 80));
    const imgs = res.filter((e) => e.initiatorType === 'img' || /\.(png|webp|jpe?g|svg|gif)/.test(e.name)).map((e) => [e.name.replace(location.origin, '').slice(0, 70), e.decodedBodySize]).sort((a, b) => b[1] - a[1]).slice(0, 8);
    return { by, fcp: Math.round(fcp || 0), domInteractive: Math.round(nav.domInteractive), load: Math.round(nav.loadEventEnd), blocking, imgs,
      lt: window.__lt.length, ltSum: Math.round(window.__lt.reduce((a, x) => a + x[1], 0)), ltMax: Math.round(Math.max(0, ...window.__lt.map((x) => x[1]))),
      heap: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null, nodes: document.getElementsByTagName('*').length };
  });
  let tot = 0, used = 0; const files = [];
  for (const e of cov) {
    if (!e.url || e.url.startsWith('data:')) continue;
    const len = (e.source || e.text || '').length; let u = 0;
    for (const f of e.functions) for (const rg of f.ranges) if (rg.count > 0 && f.ranges.indexOf(rg) === 0) u += rg.endOffset - rg.startOffset;
    tot += len; used += Math.min(u, len);
    files.push([e.url.replace(/^https?:\/\/[^/]+/, '').split('?')[0].slice(0, 70), len, Math.min(u, len)]);
  }
  console.log(`${PHONE ? 'phone 390' : 'desktop 1440'}: DCL ${dcl} ms, FCP ${r.fcp} ms, domInteractive ${r.domInteractive}, load ${r.load}, FIRST CHART ${chart} ms`);
  console.log(`long tasks during load: ${r.lt}, sum ${r.ltSum} ms, max ${r.ltMax} ms; heap ${r.heap} MB; DOM nodes ${r.nodes}`);
  console.log('render-blocking:', r.blocking.join(' | ') || 'none');
  console.log('resources by initiator/host:');
  for (const [k, v] of Object.entries(r.by).sort((a, b) => b[1].dec - a[1].dec)) console.log(`  ${k.padEnd(48)} n=${String(v.n).padStart(3)} xfer=${Math.round(v.xfer / 1024)}KB decoded=${Math.round(v.dec / 1024)}KB`);
  console.log('largest images:', r.imgs.map((x) => x[0] + ' ' + Math.round(x[1] / 1024) + 'KB').join(', '));
  console.log(`JS coverage: ${files.length} scripts, ${Math.round(tot / 1024)} KB source, functions-entered ${Math.round(used / 1024)} KB`);
  files.sort((a, b) => b[1] - a[1]).slice(0, 15).forEach((f) => console.log(`  ${String(Math.round(f[1] / 1024)).padStart(5)} KB  ${f[0]}`));
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
