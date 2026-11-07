// "Use our levels in your platform" (LEVELS-EXPORT, Owner 07 Nov): today's levels as a list, in the formats trading platforms can read,
// plus a member-specific secret link that keeps a platform up to date. Pure helpers + the /lv/* route. Pro only (the same Pro rule as the
// levels download: GEX+ Pro, admin or demo). Education only. Not financial advice.
//
// DATA (all real, nothing made up): the latest ZoroOptions summaries (zo table: SPX, SPY, QQQ; ES and NQ are the summary's own mapped
// futures levels, ratio x futures price) and the latest dark pool prints part (scan table, dp_spy / dp_qqq) of the last New York session.
// Missing pieces stay missing; a row is never filled in.
//
// ROUTES (Worker): GET /lv/pack?u=&inc=&format=   member's Firebase token (Authorization: Bearer)  -> the levels now, for the page
//                  GET /lv/token                    token  -> { active, made, exp, last } (also extends a live link while the member is Pro)
//                  POST /lv/token                   token  -> { url } (a NEW link; the old one stops working at once)
//                  DELETE /lv/token                 token  -> link turned off
//                  GET /lv/feed/<secret>.<ext>?u=&inc=   the platform plugin, no sign-in, the secret is the key (rate limited per link)
// The site reaches these through functions/api/lv/[[path]].js (same origin; the browser never calls the Worker directly).
// The secret is 32 random bytes (base64url); only its SHA-256 is stored. A link works while the member stays Pro (it lapses at the end of
// the paid period + 3 days, or 30 days after the member last opened the site's platform page, whichever is first).
import { zoGet, zoGunzip } from './zoro.js';

export const LV_SYMS = ['SPX', 'SPY', 'QQQ', 'ES', 'NQ'];
export const LV_INC = ['gex', 'em', 'nodes', 'dp'];
export const LV_EXT = ['csv', 'json', 'tv', 'tos', 'prices'];
export const LV_DP_MIN = 25e6;          // big dark pool print: $25M and up
export const LV_DP_MAX_ROWS = 8;
export const LV_NODE_ROWS = 5;
export const LV_TOKEN_DAYS = 30;
const GRACE_MS = 3 * 24 * 3600 * 1000;  // same grace as rt-auth.js / the subscriptions sweep
export const LV_NOTICE = 'Education only. Not financial advice.';
const SRC = { SPX: { s: 'SPX', e: 'SPY' }, SPY: { s: 'SPY', e: 'SPY' }, QQQ: { s: 'QQQ', e: 'QQQ' }, ES: { s: 'SPX', e: 'SPY', fut: 'ES' }, NQ: { s: 'QQQ', e: 'QQQ', fut: 'NQ' } };
// conditions that mean a print's price is not the market price of that moment (same list as assets/chart-darkpool.js)
const OFF_PRICE = 'BW47VPZU';
const fin = (x) => typeof x === 'number' && Number.isFinite(x);
const r2 = (x) => Math.round(x * 100) / 100;

export function etDay(ms) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
}

// ---- snapshot: the small slice of stored data the file needs (built in the Durable Object, cached 60 s at the edge) -----------------------
const pickSum = (j) => ({ u: j.u, built: j.built, day: j.day, spot: j.spot, levels: j.levels || null, ranges: j.ranges || null, nodes: Array.isArray(j.nodes) ? j.nodes.slice(0, 12) : [], fut: j.fut || null });
export async function lvSnapshot(sql, nowMs) {
  const sums = {}, dp = {};
  for (const s of ['SPX', 'SPY', 'QQQ']) {
    const r = zoGet(sql, 'summary', s, '');
    if (!r) continue;
    try { sums[s] = pickSum(await zoGunzip(r.gz)); } catch (e) { /* unreadable: stays missing */ }
  }
  for (const e of ['SPY', 'QQQ']) {
    const r = sql.exec('SELECT t, gz FROM scan WHERE part = ?', 'dp_' + e.toLowerCase()).toArray()[0];
    if (!r) continue;
    try {
      const j = await zoGunzip(r.gz);
      const day = Array.isArray(j.days) && j.days.length ? j.days[j.days.length - 1] : null;
      const rows = [];
      for (const x of j.rows || []) {
        const v = x[1] * x[2];
        if (v >= LV_DP_MIN && etDay(x[0]) === day && !String(x[3] || '').split('').some((c) => OFF_PRICE.includes(c))) rows.push([x[0], x[1], x[2]]);
      }
      dp[e] = { t: j.t, day, rows };
    } catch (err) { /* stays missing */ }
  }
  return { at: Math.floor(nowMs / 1000), sums, dp };
}

// ---- pack: the levels for one symbol ----------------------------------------------------------------------------------------------------
// -> { u, day, updated (epoch s), rows: [{ type, label, price, value, group }], notes: [text] }  or { error }
export function buildPack(snap, u, inc) {
  const spec = SRC[u];
  if (!spec) return { error: 'bad u (' + LV_SYMS.join(', ') + ')' };
  const want = new Set(inc && inc.length ? inc : LV_INC);
  const sum = snap && snap.sums && snap.sums[spec.s];
  if (!sum) return { error: 'no data' };
  const F = spec.fut ? (sum.fut && sum.fut.root === spec.fut && fin(sum.fut.ratio) && sum.fut.ratio > 0 ? sum.fut : null) : null;
  if (spec.fut && !F) return { error: 'no data' };
  const k = F ? F.ratio : 1;
  const m = (x) => (fin(x) ? r2(x * k) : null);
  const rows = [], notes = [];
  const add = (group, type, label, price, value) => { if (fin(price)) rows.push({ type, label, price, value: value === undefined ? null : value, group }); };
  const lv = F ? { call_ceiling: F.call_ceiling, put_floor: F.put_floor, flip_line: F.flip_line, pin: F.pin } : (sum.levels || {});
  const rg = F ? F.ranges || {} : sum.ranges || {};
  if (want.has('gex')) {
    add('gex', 'call_ceiling', 'Call Ceiling', fin(lv.call_ceiling) ? (F ? lv.call_ceiling : r2(lv.call_ceiling)) : null);
    add('gex', 'flip_line', 'Flip Line', fin(lv.flip_line) ? (F ? lv.flip_line : r2(lv.flip_line)) : null);
    add('gex', 'put_floor', 'Put Floor', fin(lv.put_floor) ? (F ? lv.put_floor : r2(lv.put_floor)) : null);
    add('gex', 'pin_strike', 'Pin Strike', fin(lv.pin) ? (F ? lv.pin : r2(lv.pin)) : null);
  }
  if (want.has('em')) {
    const a = rg['0'], w = rg.w;
    if (Array.isArray(a) && fin(a[0]) && fin(a[1])) { const hi = F ? a[1] : r2(a[1]), lo = F ? a[0] : r2(a[0]); add('em', 'range_0dte_high', 'Zoro Range 0DTE high', hi); add('em', 'range_0dte_low', 'Zoro Range 0DTE low', lo); }
    if (Array.isArray(w) && fin(w[0]) && fin(w[1])) { const hi = F ? w[1] : r2(w[1]), lo = F ? w[0] : r2(w[0]); add('em', 'range_weekly_high', 'Zoro Range weekly high', hi); add('em', 'range_weekly_low', 'Zoro Range weekly low', lo); }
  }
  if (want.has('nodes')) {
    const nd = (sum.nodes || []).filter((n) => n && fin(n.k) && fin(n.share)).slice().sort((a, b) => b.share - a.share).slice(0, LV_NODE_ROWS);
    nd.forEach((n, i) => add('nodes', 'zoro_level', 'Zoro Level ' + (i + 1), m(n.k), r2(n.share * 100)));
  }
  let updated = sum.built;
  if (want.has('dp')) {
    const part = snap.dp && snap.dp[spec.e];
    // price scale from the ETF to this symbol: both prices must come from the same moment (summaries built within 10 min of each other)
    let sc = null;
    const etfSum = snap.sums[spec.e];
    if (u === spec.e) sc = 1;
    else if (spec.fut && F && etfSum && fin(etfSum.spot) && etfSum.spot > 0 && fin(F.price) && Math.abs((etfSum.built || 0) - sum.built) <= 600) sc = F.price / etfSum.spot;
    else if (!spec.fut && etfSum && fin(etfSum.spot) && etfSum.spot > 0 && fin(sum.spot) && Math.abs((etfSum.built || 0) - sum.built) <= 600) sc = sum.spot / etfSum.spot;
    if (part && part.rows.length && sc) {
      const by = new Map();
      for (const x of part.rows) { const key = r2(x[1]); const g = by.get(key) || { p: key, v: 0, n: 0 }; g.v += x[1] * x[2]; g.n++; by.set(key, g); }
      const top = [...by.values()].sort((a, b) => b.v - a.v).slice(0, LV_DP_MAX_ROWS);
      top.sort((a, b) => b.p - a.p);
      for (const g of top) add('dp', 'dark_pool', 'Dark pool $' + Math.round(g.v / 1e6) + 'M', r2(g.p * sc), Math.round(g.v / 1e6));
      if (u !== spec.e) notes.push('Dark pool prints are in ' + spec.e + ' and moved to the ' + u + ' price scale.');
      if (part.t && part.t > updated) updated = part.t;
    } else if (part && part.rows.length && !sc) notes.push('Dark pool prints left out: no matching price scale right now.');
  }
  if (F) notes.push('Levels are mapped from ' + spec.s + ' to ' + spec.fut + '.');
  return { u, day: sum.day || null, updated: sum.built, built: updated, rows, notes };
}

// ---- formats ----------------------------------------------------------------------------------------------------------------------------
export const LV_COLORS = { call_ceiling: '#ef4444', flip_line: '#f59e0b', put_floor: '#22c55e', pin_strike: '#94a3b8', range_0dte_high: '#8b7cf6', range_0dte_low: '#8b7cf6', range_weekly_high: '#8b7cf6', range_weekly_low: '#8b7cf6', zoro_level: '#38bdf8', dark_pool: '#00adb5' };
const TOS_COLOR = { call_ceiling: 'Color.RED', flip_line: 'Color.ORANGE', put_floor: 'Color.GREEN', pin_strike: 'Color.GRAY', zoro_level: 'Color.CYAN', dark_pool: 'Color.DARK_GREEN' };
const iso = (s) => new Date(s * 1000).toISOString().replace(/\.\d+Z$/, 'Z');
const clean = (s) => String(s).replace(/[;=,"\r\n]/g, ' ');
const etClock = (s) => new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(s * 1000)) + ' ET';

// CSV for platform plugins and spreadsheets: symbol,type,label,price,value,day,updated ('#' lines are notes; plugins skip them)
export function packCsv(p) {
  const head = 'symbol,type,label,price,value,day,updated';
  const lines = p.rows.map((r) => [p.u, r.type, clean(r.label), r.price, r.value === null ? '' : r.value, p.day || '', iso(p.updated)].join(','));
  return head + '\n' + lines.join('\n') + (lines.length ? '\n' : '') + '# ' + LV_NOTICE + '\n' + p.notes.map((n) => '# ' + n + '\n').join('');
}
// price list for tools that import lines: price,label,colour
export function packPrices(p) {
  return 'price,label,color\n' + p.rows.map((r) => [r.price, clean(r.label), LV_COLORS[r.type]].join(',')).join('\n') + (p.rows.length ? '\n' : '') + '# ' + LV_NOTICE + '\n';
}
// one line the chart script reads: "ZL1|SYMBOL|DAY|EPOCH;Name=price;Name=price"
export function packTv(p) {
  return ['ZL1|' + p.u + '|' + (p.day || '') + '|' + p.updated].concat(p.rows.map((r) => clean(r.label) + '=' + r.price)).join(';');
}
export function packTos(p) {
  const out = ['# TradeZoro levels for ' + p.u + ', ' + (p.day || '') + ', updated ' + etClock(p.updated) + '. ' + LV_NOTICE, '# Paste into a new study (Studies > Edit Studies > Create). Paste a fresh copy when the levels change.'];
  p.rows.forEach((r, i) => {
    const n = 'L' + (i + 1), col = TOS_COLOR[r.type] || 'Color.VIOLET';
    out.push('plot ' + n + ' = ' + r.price + ';', n + '.SetDefaultColor(' + col + ');', n + '.SetLineWeight(1);', n + '.HideBubble();', n + '.HideTitle();',
      'AddChartBubble(IsNaN(close[-1]) and !IsNaN(close), ' + n + ', "' + clean(r.label) + ' ' + r.price + '", ' + col + ', yes);');
  });
  return out.join('\n') + '\n';
}
export function packJson(p) {
  return JSON.stringify({ notice: LV_NOTICE, symbol: p.u, day: p.day, updated: iso(p.updated), notes: p.notes, levels: p.rows.map((r) => ({ type: r.type, label: r.label, price: r.price, value: r.value, color: LV_COLORS[r.type] })) });
}
const CT = { csv: 'text/csv; charset=utf-8', prices: 'text/csv; charset=utf-8', json: 'application/json; charset=utf-8', tv: 'text/plain; charset=utf-8', tos: 'text/plain; charset=utf-8' };
export function renderPack(p, ext) {
  return { body: ext === 'json' ? packJson(p) : ext === 'tv' ? packTv(p) : ext === 'tos' ? packTos(p) : ext === 'prices' ? packPrices(p) : packCsv(p), type: CT[ext] };
}

// query -> { u, inc } or { error }
export function lvParams(q) {
  const g = (k) => String((q.get ? q.get(k) : q[k]) || '');
  const u = (g('u') || 'SPX').toUpperCase();
  if (!SRC[u]) return { error: 'bad u (' + LV_SYMS.join(', ') + ')' };
  const raw = g('inc');
  const inc = raw ? raw.split(',').map((s) => s.trim()) : LV_INC.slice();
  if (!inc.length || !inc.every((s) => LV_INC.includes(s))) return { error: 'bad inc (' + LV_INC.join(', ') + ')' };
  return { u, inc };
}

// ---- secret links -----------------------------------------------------------------------------------------------------------------------
export const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
export function newSecret() {
  const b = crypto.getRandomValues(new Uint8Array(32));
  let s = ''; for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export async function sha256Hex(s) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, '0')).join('');
}
export function lvInit(sql) {
  sql.exec('CREATE TABLE IF NOT EXISTS lvtok (h TEXT PRIMARY KEY, uid TEXT NOT NULL, exp INTEGER NOT NULL, made INTEGER NOT NULL, last INTEGER NOT NULL) WITHOUT ROWID');
  sql.exec('CREATE INDEX IF NOT EXISTS lvtok_uid ON lvtok (uid)');
}
export function lvTokPut(sql, h, uid, exp, now) {
  sql.exec('DELETE FROM lvtok WHERE uid = ?', uid);   // one link per member: a new one replaces the old one
  sql.exec('INSERT INTO lvtok (h, uid, exp, made, last) VALUES (?, ?, ?, ?, 0)', h, uid, exp, now);
}
export const lvTokGet = (sql, h) => sql.exec('SELECT uid, exp FROM lvtok WHERE h = ?', h).toArray()[0] || null;
export const lvTokInfo = (sql, uid) => sql.exec('SELECT made, exp, last FROM lvtok WHERE uid = ?', uid).toArray()[0] || null;
export const lvTokDel = (sql, uid) => sql.exec('DELETE FROM lvtok WHERE uid = ?', uid);
export function lvTokTouch(sql, uid, exp) { sql.exec('UPDATE lvtok SET exp = ? WHERE uid = ?', exp, uid); }
export function lvTokUsed(sql, h, now) { sql.exec('UPDATE lvtok SET last = ? WHERE h = ? AND last < ?', now, h, now - 300); }
export function lvTokTrim(sql, now) { sql.exec('DELETE FROM lvtok WHERE exp < ?', now - 7 * 86400000); }

// -> { uid, exp (ms) } for a verified, currently-Pro member, else null. R = rt-auth.js exports (kept as a parameter so the tests need no network).
export async function lvProUntil(token, R, f = fetch, nowMs = Date.now()) {
  const uid = await R.verifyIdToken(token);
  if (!uid) return null;
  const cap = nowMs + LV_TOKEN_DAYS * 86400000;
  if (await R.isAdminToken(token)) return { uid, exp: cap };
  const r = await f('https://firestore.googleapis.com/v1/projects/' + R.RT_PROJECT + '/databases/(default)/documents/students/' + encodeURIComponent(uid), { headers: { authorization: 'Bearer ' + token } });
  if (r.status !== 200) return null;
  const fl = ((await r.json()) || {}).fields || {};
  if (fl.demo && fl.demo.booleanValue === true) return { uid, exp: cap };
  if (!R.isActiveProDoc(fl, await R.paidPlanNames(f), nowMs)) return null;
  const pt = fl.paidThroughMillis ? Number(fl.paidThroughMillis.integerValue ?? fl.paidThroughMillis.doubleValue ?? fl.paidThroughMillis.stringValue) : 0;
  const founding = !!(fl.foundingMember && fl.foundingMember.booleanValue === true);
  const exp = pt > 0 && !founding ? Math.min(cap, pt + GRACE_MS) : cap;
  return exp > nowMs ? { uid, exp } : null;
}

// ---- the route --------------------------------------------------------------------------------------------------------------------------
const JSON_H = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };
const PRIV = { 'cache-control': 'private, no-store', 'x-robots-tag': 'noindex', 'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff' };
const jerr = (status, error, h, extra) => new Response(JSON.stringify({ error }), { status, headers: Object.assign({}, JSON_H, h, extra || {}) });

// deps = { stub(env), proUntil(token) -> {uid, exp}|null, bearer(req), now() -> ms }
export async function lvRoute(req, u, env, ctx, h, deps) {
  const path = u.pathname.slice(3);   // after /lv
  const st = deps.stub(env);
  const nowMs = deps.now();
  async function snapshot() {
    const ckey = new Request('https://book-recorder.cache/lv-snap/' + Math.floor(nowMs / 60000));
    const hit = await caches.default.match(ckey);
    if (hit) return hit.json();
    const r = await st.fetch('https://do/lv-snap');
    if (r.status !== 200) return null;
    const j = await r.json();
    ctx.waitUntil(caches.default.put(ckey, new Response(JSON.stringify(j), { headers: { 'cache-control': 'public, max-age=60' } })));
    return j;
  }
  async function serve(q, ext) {
    const p = lvParams(q);
    if (p.error) return jerr(400, p.error, h);
    const snap = await snapshot();
    if (!snap) return jerr(503, 'no data', h, { 'retry-after': '60' });
    const pack = buildPack(snap, p.u, p.inc);
    if (pack.error === 'no data') return jerr(404, 'no data', h);
    if (pack.error) return jerr(400, pack.error, h);
    const o = renderPack(pack, ext);
    const hd = Object.assign({ 'content-type': o.type }, h, PRIV);
    return new Response(o.body, { headers: hd });
  }
  const limit = async (key) => {
    const rl = env.RL_LV || env.RL;
    if (!rl) return true;
    try { return (await rl.limit({ key })).success; } catch (e) { return true; }
  };

  // GET /lv/feed/<secret>.<ext>: the platform plugin. The secret is the credential; nothing else is read from the caller.
  const fm = /^\/feed\/([A-Za-z0-9_-]{43})\.([a-z]+)$/.exec(path);
  if (fm) {
    if (req.method !== 'GET') return new Response('GET only', { status: 405, headers: h });
    if (!LV_EXT.includes(fm[2])) return jerr(404, 'not found', h);
    const hash = await sha256Hex(fm[1]);
    if (!(await limit('lv:' + hash.slice(0, 16)))) return new Response('slow down', { status: 429, headers: Object.assign({ 'retry-after': '60' }, h, PRIV) });
    const tk = await (await st.fetch('https://do/lv-tok-get?h=' + hash)).json();
    if (!tk || !(tk.exp > nowMs)) return jerr(404, 'link not active', h, PRIV);   // one answer for unknown, revoked and lapsed: nothing to probe
    ctx.waitUntil(st.fetch('https://do/lv-tok-used?h=' + hash));
    return serve(u.searchParams, fm[2]);
  }

  // everything below needs the member's own sign-in token and a current Pro plan (fail closed)
  if (!['/pack', '/token'].includes(path)) return jerr(404, 'not found', h);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: h });
  let who = null;
  try { who = await deps.proUntil(deps.bearer(req)); } catch (e) { who = null; }
  if (!who) return jerr(403, 'pro_required', h);
  if (!(await limit('lvm:' + who.uid))) return new Response('slow down', { status: 429, headers: Object.assign({ 'retry-after': '60' }, h) });
  if (path === '/pack') {
    if (req.method !== 'GET') return new Response('GET only', { status: 405, headers: h });
    const ext = u.searchParams.get('format') || 'json';
    if (!LV_EXT.includes(ext)) return jerr(400, 'bad format (' + LV_EXT.join(', ') + ')', h);
    return serve(u.searchParams, ext);
  }
  if (req.method === 'GET') {
    const i = await (await st.fetch('https://do/lv-tok-info?uid=' + encodeURIComponent(who.uid))).json();
    if (i && i.exp > nowMs) { await st.fetch('https://do/lv-tok-touch?uid=' + encodeURIComponent(who.uid) + '&exp=' + who.exp); i.exp = who.exp; }
    return new Response(JSON.stringify(i && i.exp > nowMs ? { active: true, made: i.made, exp: i.exp, last: i.last || null } : { active: false }), { headers: Object.assign({}, JSON_H, h) });
  }
  if (req.method === 'POST') {
    const secret = newSecret();
    await st.fetch('https://do/lv-tok-put?h=' + (await sha256Hex(secret)) + '&uid=' + encodeURIComponent(who.uid) + '&exp=' + who.exp);
    return new Response(JSON.stringify({ active: true, secret, exp: who.exp, notice: LV_NOTICE }), { headers: Object.assign({}, JSON_H, h) });
  }
  if (req.method === 'DELETE') {
    await st.fetch('https://do/lv-tok-del?uid=' + encodeURIComponent(who.uid));
    return new Response(JSON.stringify({ active: false }), { headers: Object.assign({}, JSON_H, h) });
  }
  return new Response('method not allowed', { status: 405, headers: h });
}
