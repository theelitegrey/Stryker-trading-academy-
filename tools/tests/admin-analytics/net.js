// Network before/after for dashboard-admin.html: which Firestore reads does
// the page make on load, on main vs this branch?
//
// Same stub fixture (stub.js, 'loaded' mode) for both. A recorder wraps
// window.__stubDb.collection so every query chain is logged at the moment a
// terminal get()/onSnapshot() runs, e.g.
//   students .orderBy(createdAt,desc).limit(5) .get
// so "unbounded" means a get() on a collection with no where()/limit().
// The Online-now REST aggregation (fetch) is logged too.
//
// Usage (two static servers, one per checkout):
//   node net.js http://localhost:8001 http://localhost:8000 <out.json>
//             (main checkout)        (branch checkout)
const fs = require('fs');
const { launch } = require('../lib.js');
const stubMod = require('./stub.js');

const RECORDER = function () {
  window.__netLog = [];
  const log = (e) => window.__netLog.push(e);
  const wrapQuery = (col, q, chain) => new Proxy(q, {
    get(t, prop) {
      const v = t[prop];
      if (typeof v !== 'function') return v;
      if (['where', 'orderBy', 'limit', 'limitToLast', 'startAfter', 'select'].includes(prop)) {
        return (...args) => wrapQuery(col, v.apply(t, args), chain.concat([prop + '(' + args.map((a) => JSON.stringify(a)).join(',') + ')']));
      }
      if (prop === 'doc') {
        return (id) => wrapDoc(col, id, v.call(t, id));
      }
      if (prop === 'get' || prop === 'onSnapshot') {
        return (...args) => {
          const bounded = chain.some((c) => /^(where|limit)/.test(c));
          log({ collection: col, chain: chain.join('.'), op: prop, unbounded: !bounded });
          return v.apply(t, args);
        };
      }
      return v.bind(t);
    }
  });
  const wrapDoc = (col, id, d) => new Proxy(d, {
    get(t, prop) {
      const v = t[prop];
      if (typeof v !== 'function') return v;
      if (prop === 'get' || prop === 'onSnapshot') {
        return (...args) => { log({ collection: col, doc: String(id), op: 'doc.' + prop, unbounded: false }); return v.apply(t, args); };
      }
      if (prop === 'collection') {
        return (sub) => wrapQuery(col + '/' + id + '/' + sub, v.call(t, sub), []);
      }
      return v.bind(t);
    }
  });
  const install = () => {
    const sdb = window.__stubDb;
    if (!sdb || sdb.__wrapped) return;
    const orig = sdb.collection;
    sdb.collection = (name) => wrapQuery(name, orig.call(sdb, name), []);
    sdb.__wrapped = true;
  };
  install();
  const of = window.fetch;
  window.fetch = function (url, opts) {
    if (typeof url === 'string' && url.indexOf('runAggregationQuery') !== -1) {
      log({ collection: 'presence', op: 'REST runAggregationQuery count(lastSeen > now-PRESENCE_ONLINE_MS)', unbounded: false, body: opts && opts.body });
    }
    return of.apply(this, arguments);
  };
};

async function record(browser, base) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await ctx.route(/^https?:\/\/(?!localhost)/, (r) => r.abort());
  await ctx.addInitScript(stubMod.build('loaded'));
  await ctx.addInitScript('(' + RECORDER.toString() + ')();');
  const p = await ctx.newPage();
  await p.goto(base + '/dashboard-admin.html', { waitUntil: 'domcontentloaded', timeout: 20000 });
  await p.waitForTimeout(3000);
  const log = await p.evaluate(() => window.__netLog);
  await ctx.close();
  return log;
}

function summarise(log) {
  const reads = log.filter((e) => e.op !== 'doc.set');
  return {
    totalReadCalls: reads.length,
    unboundedCollectionGets: reads.filter((e) => e.unbounded).map((e) => e.collection + (e.chain ? '.' + e.chain : '') + '.' + e.op),
    studentsCalls: reads.filter((e) => e.collection === 'students').map((e) => (e.doc ? 'doc(' + e.doc + ').get' : (e.chain || '(none)') + '.' + e.op)),
    byCollection: reads.reduce((m, e) => { m[e.collection] = (m[e.collection] || 0) + 1; return m; }, {})
  };
}

(async () => {
  const [mainBase, branchBase, out] = process.argv.slice(2);
  const browser = await launch({ headless: true });
  try {
    const main = await record(browser, mainBase);
    const branch = await record(browser, branchBase);
    const result = {
      generatedAt: new Date().toISOString(),
      fixture: "tools/tests/admin-analytics/stub.js mode 'loaded'",
      main: { summary: summarise(main), calls: main },
      branch: { summary: summarise(branch), calls: branch }
    };
    fs.writeFileSync(out, JSON.stringify(result, null, 2));
    console.log(JSON.stringify({ main: result.main.summary, branch: result.branch.summary }, null, 2));
  } finally {
    await browser.close();
  }
})();
