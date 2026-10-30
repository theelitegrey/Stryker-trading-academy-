// Creator Hub: compile check for an uploaded Pine indicator (module Web Worker, started by assets/creator-ind.js).
// Runs the script on the SAME engine members' charts use for community indicators (pinets 0.11.0 + our patches,
// see assets/chart-pine-next-worker.js), on 400 synthetic 5-minute bars, off the page thread.
// main -> worker: { id, source }    worker -> main: { id, ok, plots, error, line }
const PINETS = 'https://cdn.jsdelivr.net/npm/pinets@0.11.0/dist/pinets.min.browser.es.js';
const ready = Promise.all([import(PINETS), import('./chart-pine-next-patches.js?v=741')]).then(([pt, patches]) => {
  try { patches.install(pt.Context, pt, self); } catch (e) {}
  return { pt, rw: patches.rewriteSource || ((s) => s) };
});
const bars = Array.from({ length: 400 }, (_, i) => {
  const o = 100 + Math.sin(i / 17) * 5 + Math.sin(i / 3), c = 100 + Math.sin((i + 1) / 17) * 5 + Math.cos(i / 5);
  const t = Date.UTC(2026, 0, 5, 14) + i * 3e5;
  return { openTime: t, closeTime: t + 3e5, open: o, high: Math.max(o, c) + 0.6, low: Math.min(o, c) - 0.6, close: c, volume: 100 + (i % 13) * 7 };
});
const src = { getMarketData: async () => bars, getSymbolInfo: async () => ({ ticker: 'TEST', tickerid: 'TEST', timezone: 'UTC', type: 'futures', mintick: 0.25, session: '24x7' }) };
function lineOf(msg, source) {
  let m = /\bat (?:line )?(\d+):(\d+)/.exec(msg) || /line (\d+)(?:, col(?:umn)? (\d+))?/i.exec(msg) || /\((\d+):(\d+)\)/.exec(msg);
  if (m) return +m[1];
  const nd = /^([A-Za-z_][\w.]*) is not (?:defined|a function)/.exec(msg);
  if (nd) {
    const re = new RegExp('(^|[^\\w.])' + nd[1].replace(/\./g, '\\.') + '\\b');
    const i = String(source).split('\n').findIndex((l) => !/^\s*\/\//.test(l) && re.test(l));
    if (i >= 0) return i + 1;
  }
  return null;
}
self.addEventListener('message', async (ev) => {
  const { id, source } = ev.data || {};
  try {
    const { pt, rw } = await ready;
    const timer = new Promise((_, rej) => setTimeout(() => rej(new Error('Took longer than 20 seconds on 400 bars.')), 20000));
    const r = await Promise.race([new pt.PineTS(src, 'TEST', '5', bars.length).run(rw(source)), timer]);
    self.postMessage({ id, ok: true, plots: Object.keys(r.plots || {}).filter((k) => !/^__/.test(k)).length });
  } catch (e) {
    const msg = String((e && e.message) || e).replace(/^Error:\s*/, '').replace(/^Failed to transpile Pine Script version \d+:\s*/, 'Syntax error: ');
    self.postMessage({ id, ok: false, error: msg.slice(0, 400), line: lineOf(msg, source) });
  }
});
