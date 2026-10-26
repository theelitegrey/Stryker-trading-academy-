// ad-hoc probe: node bt-probe.js <dev> "<js expression evaluated after a session starts>" [query] [shot]
const R = require('./bt-rig.js');
(async () => {
  const [dev, expr, q, shotf] = process.argv.slice(2);
  const srv = await R.serve(process.env.BT_ROOT || undefined); const b = await R.launch();
  try {
    const { p, errors } = await R.page(b, srv, dev || 'phone');
    await R.startSession(p, srv.base, q || '');
    const out = await p.evaluate(expr);
    console.log(JSON.stringify(out, null, 1));
    if (shotf) await R.shot(p, shotf);
    if (errors.length) console.log('errors', errors);
  } finally { await b.close(); srv.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
