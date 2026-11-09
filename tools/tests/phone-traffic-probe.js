// Probe: page <-> Pine worker traffic (messages, bars per message, model sizes) and all-node DOM growth (text + shadow).
//   CHART_BASE=... HUB=... flock /tmp/stryker-chrome.lock node tools/tests/phone-traffic-probe.js [secs]
const { launch } = require('./lib.js');
const { openPhone } = require('./phone-mem-lib.js');
const SECS = +(process.argv[2] || 60);
(async () => {
  const b = await launch();
  try {
    const { p, ctx } = await openPhone(b, { base: process.env.CHART_BASE || 'http://127.0.0.1:8460', hub: process.env.HUB || 'http://127.0.0.1:8461' });
    await p.evaluate(() => {
      const st = window.__tr = { out: {}, in: {}, barsOut: 0, modelChars: 0, models: 0 };
      const pm = Worker.prototype.postMessage;
      Worker.prototype.postMessage = function (m) {
        try { const k = m && m.kind || '?'; st.out[k] = (st.out[k] || 0) + 1; if (m && Array.isArray(m.bars)) { st.barsOut += m.bars.length; st.bk = st.bk || {}; st.bk[k] = (st.bk[k] || 0) + m.bars.length; } if (m && m.req && Array.isArray(m.req.bars)) st.barsOut += m.req.bars.length; } catch (e) {}
        if (!this.__tap) { this.__tap = true; this.addEventListener('message', (e) => { const d = e.data || {}; const k = d.kind || d.type || '?'; st.in[k] = (st.in[k] || 0) + 1; if (d.kind === 'model') { st.models++; if (st.models % 5 === 1) try { st.modelChars += JSON.stringify(d.model).length; st.modelSampled = (st.modelSampled || 0) + 1; } catch (x) {} } }); }
        return pm.apply(this, arguments);
      };
    }).catch(() => {});
    await p.waitForFunction(() => window.__stkFirstCandles && window.__stkHeavyReady, null, { timeout: 120000 });
    await p.waitForTimeout(15000);
    const count = () => p.evaluate(() => {
      let n = 0, text = 0, shadow = 0;
      const walk = (root) => { const w = document.createTreeWalker(root, NodeFilter.SHOW_ALL); let x = w.currentNode; while (x) { n++; if (x.nodeType === 3) text++; if (x.shadowRoot) { shadow++; walk(x.shadowRoot); } x = w.nextNode(); } };
      walk(document);
      const st = window.__tr; const r = { n, text, shadow, tr: JSON.parse(JSON.stringify(st)) };
      return r;
    });
    const a = await count();
    await p.waitForTimeout(SECS * 1000);
    const c = await count();
    const cdp = await ctx.newCDPSession(p);
    await cdp.send('HeapProfiler.collectGarbage');
    console.log('DOM nodes (all, incl text+shadow):', a.n, '->', c.n, 'text', a.text, '->', c.text, 'shadow roots', c.shadow);
    console.log('DOM counters', JSON.stringify(await cdp.send('Memory.getDOMCounters')));
    const d = (k) => { const o = {}; for (const x in c.tr[k]) o[x] = c.tr[k][x] - ((a.tr[k] || {})[x] || 0); return o; };
    console.log(`in ${SECS}s: page->worker`, JSON.stringify(d('out')), 'bars posted', c.tr.barsOut - a.tr.barsOut, JSON.stringify(c.tr.bk), JSON.stringify(a.tr.bk), '| worker->page', JSON.stringify(d('in')), '| model ~KB each', Math.round(c.tr.modelChars / Math.max(1, c.tr.modelSampled) / 1024));
  } finally { await b.close(); }
})().catch((e) => { console.error(e); process.exit(2); });
