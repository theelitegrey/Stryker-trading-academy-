// Zscript runner (page side): owns the sandboxed worker, enforces the wall-clock kill,
// and turns the message protocol into promises. SPEC.md section 11.2.
//   const r = new ZsRunner();
//   const out = await r.run({ program, bars, symbol, timeframe, inputs, allowed, data, securities });
//   const out2 = await r.update({ bar, data });
//   r.dispose();
//   options: new ZsRunner({ onLive(out), onNotice({ns, state, upgrade, text}) })
//   protected: const pub = await r.session(); ...get sealed from the API...; await r.run({ sealed, bars, ... })
const WORKER_URL = new URL('./worker.js?v=984', import.meta.url);
export const KILL_MS = { run: 25000, update: 8000, compile: 10000 };

function killed(ms) {
  return { ok: false, error: { code: 'E401', severity: 'error', line: 1, col: 1, message: 'The script took longer than ' + Math.round(ms / 1000) + ' seconds and was stopped.', hint: 'Look for a loop that runs too many times.' },
    plots: [], hlines: [], fills: [], labels: [], lines: [], boxes: [], tables: [], alerts: [], alertconditions: [], notices: [], bars: 0, ms };
}

export class ZsRunner {
  constructor(opts) {
    this.opts = opts || {};
    this.w = null; this.seq = 0; this.pending = new Map(); this.hasRun = false;
  }
  spawn() {
    if (this.w) return this.w;
    const w = new Worker(this.opts.workerUrl || WORKER_URL, { type: 'module', name: 'zscript' });
    w.onmessage = (ev) => {
      const m = ev.data;
      if (m && m.type === 'live') { if (this.opts.onLive) this.opts.onLive(m.out); return; }
      if (m && m.type === 'notice') { if (this.opts.onNotice) this.opts.onNotice(m); return; }
      if (!m || !Number.isInteger(m.id)) return;
      const p = this.pending.get(m.id);
      if (!p) return;
      this.pending.delete(m.id); clearTimeout(p.timer);
      if (m.type === 'result') p.resolve(m.out);
      else p.reject(new Error(typeof m.message === 'string' ? m.message : 'Zscript worker error'));
    };
    w.onerror = (ev) => { ev.preventDefault && ev.preventDefault(); this.reset(new Error('The Zscript worker stopped.')); };
    this.w = w;
    return w;
  }
  reset(err) {
    if (this.w) { this.w.terminate(); this.w = null; }
    this.hasRun = false;
    for (const [, p] of this.pending) { clearTimeout(p.timer); p.reject(err); }
    this.pending.clear();
  }
  send(type, msg, ms) {
    const w = this.spawn();
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        // a runaway script: kill the worker outright (the VM also stops itself at 20 s)
        this.pending.delete(id);
        this.reset(new Error('stopped'));
        resolve(type === 'compile' ? { ok: false, diagnostics: [killed(ms).error], program: null, meta: null } : killed(ms));
      }, ms);
      this.pending.set(id, { resolve, reject, timer });
      w.postMessage(Object.assign({ type, id }, msg));
    });
  }
  compile(source) { return this.send('compile', { source }, KILL_MS.compile); }
  // Protected scripts: the worker makes a key pair and returns the public half for the delivery API.
  async session() { const out = await this.send('session', {}, KILL_MS.compile); return out && out.pub; }
  // Protected library script: the worker opens the sealed program and keeps it; only titles/inputs/overlay come back.
  open(sealed) { return this.send('open', { sealed }, KILL_MS.compile); }
  // Data hub (S3) messages go to the worker untouched: hub.open({ post: (m) => runner.post(m) }).
  post(msg) { if (msg && typeof msg === 'object') this.spawn().postMessage(msg); }
  async run(o) {
    const out = await this.send('run', {
      program: o.program, sealed: o.sealed, held: !!o.held, bars: o.bars, symbol: o.symbol, timeframe: o.timeframe, inputs: o.inputs || {},
      allowed: o.allowed || {}, data: o.data || {}, securities: o.securities || {}, lastBarClosed: !!o.lastBarClosed,
    }, KILL_MS.run);
    this.hasRun = !!(out && out.bars);
    return out;
  }
  update(o) {
    if (!this.hasRun) return Promise.reject(new Error('run() first'));
    return this.send('update', { bar: Object.assign({}, o.bar, o.data ? { data: o.data } : {}) }, KILL_MS.update);
  }
  dispose() { this.reset(new Error('disposed')); }
}
