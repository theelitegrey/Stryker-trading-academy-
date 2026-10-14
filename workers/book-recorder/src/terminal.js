// "Terminal" files of the book-recorder Worker: the pre-market brief, the cross-asset market map and
// the economic calendar (the same JSON the site commits as assets/market-brief.json,
// assets/market-map.json, assets/econ-calendar.json).
//
// WHY: those three files were rebuilt once a day by an agent session that committed them to main.
// That session stopped on 2026-10-09 and the pages showed a 5-day-old board. They are now built on
// our own server (brief-feeder/brief_feeder.py, systemd timer) from InsightSentry data, and
// published HERE so an intraday refresh (every 15 min in the US session) needs no site deploy.
// The pages read GET /terminal/<name>.json first and fall back to the committed copy.
//
//   POST /terminal-ingest?name=N   feeder only (x-ingest-key), JSON body (the whole file) <= 512 KB
//   GET  /terminal/N.json          public (our origins), edge-cached 60 s
//   GET  /terminal/health          { ok, files: { N: { generatedAt, goodUntil, ok } } }; HTTP 503
//                                  when a file is missing or past its goodUntil (site health monitor)
export const TERMINAL_NAMES = ['market-brief', 'market-map', 'econ-calendar'];
export const TERMINAL_MAX_BODY = 512 * 1024;
const FRESH_MS = 30 * 60000;   // generatedAt must be within 30 min of the Worker's clock
const MAX_GOOD_MS = 4 * 86400000;   // goodUntil never more than 4 days ahead (a long weekend)

// Shape checks for one ingest. Returns { error } or { ok, generatedAt, goodUntil }.
export function validateTerminal(name, body, nowMs) {
  if (!TERMINAL_NAMES.includes(name)) return { error: 'bad name' };
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'bad body' };
  if (body.schema !== 1) return { error: 'schema' };
  const g = Date.parse(body.generatedAt), u = Date.parse(body.goodUntil);
  if (!Number.isFinite(g) || Math.abs(nowMs - g) > FRESH_MS) return { error: 'generatedAt stale or future' };
  if (!Number.isFinite(u) || u <= g || u - nowMs > MAX_GOOD_MS) return { error: 'goodUntil' };
  if (name === 'market-brief' && !(typeof body.headline === 'string' && body.headline && Array.isArray(body.bullets) && body.bullets.length)) return { error: 'brief shape' };
  if (name === 'market-map' && !(Array.isArray(body.groups) && body.groups.length && Array.isArray(body.periods) && body.curve)) return { error: 'map shape' };
  if (name === 'econ-calendar' && !(Array.isArray(body.events) && body.events.length && Array.isArray(body.currencies))) return { error: 'calendar shape' };
  return { ok: true, generatedAt: g, goodUntil: u };
}

// Health of the stored set: every file present and inside its goodUntil.
export function terminalHealth(rows, nowMs) {
  const files = {};
  let ok = true;
  for (const n of TERMINAL_NAMES) {
    const r = rows.find((x) => x.name === n);
    if (!r) { files[n] = { ok: false, missing: true }; ok = false; continue; }
    const fresh = nowMs <= r.u;
    files[n] = { ok: fresh, generatedAt: new Date(r.g).toISOString(), goodUntil: new Date(r.u).toISOString(), storedAt: new Date(r.t).toISOString() };
    if (!fresh) ok = false;
  }
  return { ok, now: new Date(nowMs).toISOString(), files };
}

// ---- Durable Object side ------------------------------------------------------------------------
export function terminalInit(sql) {
  sql.exec(`CREATE TABLE IF NOT EXISTS terminal (name TEXT PRIMARY KEY, t INTEGER NOT NULL, g INTEGER NOT NULL, u INTEGER NOT NULL, j TEXT NOT NULL) WITHOUT ROWID`);
}
export function terminalDo(self, u, req) {
  const p = u.pathname, name = u.searchParams.get('name');
  if (p === '/t/ingest') {
    return req.text().then((j) => {
      const g = Number(u.searchParams.get('g')), uu = Number(u.searchParams.get('u'));
      self.sql.exec('INSERT OR REPLACE INTO terminal (name, t, g, u, j) VALUES (?, ?, ?, ?, ?)', name, Date.now(), g, uu, j);
      return new Response('stored ' + name);
    });
  }
  if (p === '/t/read') {
    const r = self.sql.exec('SELECT j FROM terminal WHERE name = ?', name).toArray()[0];
    return r ? new Response(r.j, { headers: { 'content-type': 'application/json; charset=utf-8' } }) : new Response('not found', { status: 404 });
  }
  if (p === '/t/health') {
    const rows = self.sql.exec('SELECT name, t, g, u FROM terminal').toArray();
    return Response.json(terminalHealth(rows, Date.now()));
  }
  return new Response('not found', { status: 404 });
}

// ---- Worker side --------------------------------------------------------------------------------
export async function terminalIngestRoute(req, env, u, authorized, stub) {
  if (req.method !== 'POST') return new Response('POST only', { status: 405 });
  if (!(await authorized(req, env))) return new Response('unauthorized', { status: 401 });
  if (Number(req.headers.get('content-length') || 0) > TERMINAL_MAX_BODY) return new Response('too large', { status: 413 });
  const buf = await req.arrayBuffer();
  if (buf.byteLength > TERMINAL_MAX_BODY) return new Response('too large', { status: 413 });
  const name = String(u.searchParams.get('name') || '');
  let body;
  try { body = JSON.parse(new TextDecoder().decode(buf)); } catch (e) { return new Response('bad json', { status: 400 }); }
  const v = validateTerminal(name, body, Date.now());
  if (v.error) return new Response(v.error, { status: 400 });
  return stub(env).fetch('https://do/t/ingest?name=' + name + '&g=' + v.generatedAt + '&u=' + v.goodUntil, { method: 'POST', body: JSON.stringify(body) });
}

// GET /terminal/<name>.json and /terminal/health. Edge-cached 60 s (health 30 s) per minute bucket.
export async function terminalRoute(u, env, ctx, h, stub) {
  const m = /^\/terminal\/([a-z-]+)(\.json)?$/.exec(u.pathname);
  const name = m && m[1];
  const health = name === 'health';
  if (!name || (!health && (!TERMINAL_NAMES.includes(name) || !m[2]))) return new Response('not found', { status: 404, headers: h });
  const key = new Request('https://book-recorder.cache/terminal/v1/' + name + '/' + Math.floor(Date.now() / (health ? 30000 : 60000)));
  let res = await caches.default.match(key);
  if (!res) {
    const d = await stub(env).fetch(health ? 'https://do/t/health' : 'https://do/t/read?name=' + name);
    let status = d.status, text = await d.text();
    if (health && status === 200) { try { if (!JSON.parse(text).ok) status = 503; } catch (e) { status = 503; } }
    res = new Response(text, { status, headers: { 'content-type': status === 404 ? 'text/plain' : 'application/json; charset=utf-8', 'cache-control': 'public, max-age=' + (health ? 30 : 60) } });
    if (status === 200) ctx.waitUntil(caches.default.put(key, res.clone()));
  }
  const out = new Response(res.body, res);
  Object.entries(h).forEach(([k, v]) => out.headers.set(k, v));
  return out;
}
