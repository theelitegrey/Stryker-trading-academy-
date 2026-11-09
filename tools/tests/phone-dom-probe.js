// Probe: what creates / removes DOM nodes over time (leak hunt), and the owner of every allocated canvas outside Vela's renderer.
//   CHART_BASE=... HUB=... flock /tmp/stryker-chrome.lock node tools/tests/phone-dom-probe.js [secs]
const { launch } = require('./lib.js');
const { openPhone } = require('./phone-mem-lib.js');
const SECS = +(process.argv[2] || 30);
(async () => {
  const b = await launch();
  try {
    const { p, ctx } = await openPhone(b, { base: process.env.CHART_BASE || 'http://127.0.0.1:8460', hub: process.env.HUB || 'http://127.0.0.1:8461' });
    await p.addInitScript(() => {});
    await p.waitForFunction(() => window.__stkFirstCandles && window.__stkHeavyReady, null, { timeout: 120000 });
    await p.waitForTimeout(15000);
    await p.evaluate(() => {
      const st = window.__dm = { made: {}, stacks: {} };
      const ce = Document.prototype.createElement;
      Document.prototype.createElement = function (t) {
        const k = String(t).toLowerCase(); st.made[k] = (st.made[k] || 0) + 1;
        if ((st.made[k] % 25) === 1) { const s = (new Error().stack || '').split('\n').slice(2, 5).map((x) => x.trim().replace(/https?:\/\/[^/]+\/assets\//, '').replace(/\?v=\d+/, '')).join(' | '); st.stacks[k + ' ' + s] = (st.stacks[k + ' ' + s] || 0) + 1; }
        return ce.apply(this, arguments);
      };
      const ct = Document.prototype.createTextNode; Document.prototype.createTextNode = function () { st.made['#text'] = (st.made['#text'] || 0) + 1; return ct.apply(this, arguments); };
      const ih = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
      Object.defineProperty(Element.prototype, 'innerHTML', { configurable: true, get() { return ih.get.call(this); }, set(v) { const k = 'innerHTML ' + (this.className && typeof this.className === 'string' ? this.className.split(' ')[0] : this.tagName); st.made[k] = (st.made[k] || 0) + 1; return ih.set.call(this, v); } });
      const tc = Object.getOwnPropertyDescriptor(Node.prototype, 'textContent');
      Object.defineProperty(Node.prototype, 'textContent', { configurable: true, get() { return tc.get.call(this); }, set(v) { if (this.nodeType === 1 && this.firstChild && this.firstChild.nodeType === 3 && !this.firstChild.nextSibling) { /* same-text-node path still makes a new node */ } const k = 'textContent ' + (this.className && typeof this.className === 'string' ? this.className.split(' ')[0] : this.tagName); st.made[k] = (st.made[k] || 0) + 1; return tc.set.call(this, v); } });
    });
    const cdp = await ctx.newCDPSession(p);
    await cdp.send('HeapProfiler.collectGarbage');
    const a = await cdp.send('Memory.getDOMCounters');
    await p.waitForTimeout(SECS * 1000);
    await cdp.send('HeapProfiler.collectGarbage');
    const c = await cdp.send('Memory.getDOMCounters');
    console.log('DOM counters', JSON.stringify(a), '->', JSON.stringify(c));
    const r = await p.evaluate(() => window.__dm);
    console.log('made in', SECS, 's:', JSON.stringify(Object.entries(r.made).sort((x, y) => y[1] - x[1]).slice(0, 20)));
    console.log('stacks:', JSON.stringify(Object.entries(r.stacks).sort((x, y) => y[1] - x[1]).slice(0, 12), null, 1));
    console.log('allocated canvases outside the plot:', JSON.stringify(await p.evaluate(() => window.__cvAll.map((r) => r.deref()).filter((c) => c && c.__px && c.isConnected && !c.closest('.vela-cell')).map((c) => { const a = []; for (let n = c; n && a.length < 5; n = n.parentElement) a.push(n.id || n.className || n.tagName); return [c.width, c.height, a.join(' < ')]; }))));
    console.log('allocated canvases in the cell, not Vela plot:', JSON.stringify(await p.evaluate(() => window.__cvAll.map((r) => r.deref()).filter((c) => c && c.__px && c.isConnected && c.closest('.vela-cell')).map((c) => { const a = []; for (let n = c; n && a.length < 4; n = n.parentElement) a.push((n.id || (typeof n.className === 'string' ? n.className : '') || n.tagName) + '[' + [...(n.parentElement ? n.parentElement.children : [])].indexOf(n) + ']'); return [c.width, c.height, c.style.cssText.slice(0, 80), a.join(' < ')]; }))));
  } finally { await b.close(); }
})().catch((e) => { console.error(e); process.exit(2); });
