// TradeZoro — GEX Ladder (Charts right-bar panel + GEX page tab) — ES module
// Owner order 2026-10-16 ("build all 4", point 1). Our own design.
//
// Depends on: assets/chart-gex-levels.js (gexFetch/gexCached: the SAME shared GEX fetch + 5-minute
// cache as the GEX Levels indicator, so the ladder adds no API calls; gexTier; convOf, gexAnchor,
// gexSource, flashLevel, dataTime), assets/chart-gex-ladder-core.js (pure ranking/format),
// assets/chart-watchlist.js (.stkw-rail, .stkchart-panel.stkw-host), assets/style.css (.stkgl-*).
//
// WHAT IT SHOWS: QQQ, SPY and SPX side by side (phones: tabs, one column at a time). Each column is a dense
// strike list (17 px rows): strike + net GEX in dollars on a cell coloured on ONE scale shared by all three
// columns (dark blue = small, green = big positive, purple/magenta = big negative, bright yellow = the single
// biggest |GEX| of the column), a spot row marked with an arrow and a thin line, and a header: symbol, spot,
// "mag <strike> <+/-%>" and the net total.
// UPDATES: while the ladder is open AND the tab is visible it polls /api/gex/ladder once a second (one request
// for all three markets, 1 s edge cache + ETag). Rows are patched in place (only changed rows are touched, a
// changed value flashes green/red), the list keeps its scroll unless it was centred on spot. Hidden tab: no
// requests. Closed: stopped. The data itself is rebuilt on the server about once a minute (see report).
// CHARTS: clicking a strike flashes a horizontal line at that strike's futures price (QQQ -> NQ/MNQ,
// SPX -> ES/MES, the same ratio + basis + re-anchor as the GEX Levels lines); on an SPX/SPY/QQQ chart the
// strike is used as is. A chart whose market does not match the column gets a short toast instead.
// PLAN: Free = SPX column only (QQQ / SPY show a "Pro" lock and are never fetched); Pro = all three.
// BAR REPLAY: the ladder is the current chain, so it says so and does not draw during replay.
// WORDING: "GEX updated Xs ago" / "X min ago" only; Education only. Not financial advice.
import { gexFetch, gexCached, gexTier, gexSource, gexAnchor, convOf, flashLevel, dataTime } from './chart-gex-levels.js?v=602';
import { ladderFromApi, sharedScale, strength, biggestIndex, magnet, netTotal, fmtMoney, spotIndex, spotPos, cellColor, MAX_FILL, updatedText, keyLevels, rowNearest, fmtPct } from './chart-gex-ladder-core.js?v=602';

export const COLS = [['QQQ', 'Nasdaq 100'], ['SPY', 'S&P 500 ETF'], ['SPX', 'S&P 500']];
const LADDER_API = '/api/gex/ladder';
const ROW_H = 17;
const PHONE_MAX = 700;
const REFRESH_MS = 1000;           // poll every second while the ladder is open and the tab is visible
const WINDOW_PCT = 0.06;
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtK = (k) => (Math.abs(k - Math.round(k)) < 1e-9 ? Math.round(k).toLocaleString('en-US') : k.toFixed(1));
const fmtSpot = (v) => Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Pure: one column's view model from an API response (null = no data yet).
export function columnModel(data, vmax) {
  if (!data || data.error) return null;
  const spot = isNum(data.spot) ? data.spot : null;
  // strikes within +-WINDOW_PCT of spot (the far wings are tiny and just make the list long)
  const rows = ladderFromApi(data).filter((r) => spot == null || Math.abs(r.k - spot) <= spot * WINDOW_PCT);
  if (!rows.length || spot == null) return null;
  const mg = magnet(rows, spot, 0.05), big = biggestIndex(rows);
  return {
    rows, spot, big, mg, spotAt: spotIndex(rows, spot), pos: spotPos(rows, spot), net: isNum(data.net_gex) ? data.net_gex : netTotal(rows),
    sig: rows.map((r) => r.k).join(','),
    items: rows.map((r, i) => ({ k: r.k, g: r.g, s: strength(r.g, vmax), big: i === big }))
  };
}

const DL = { 0: '0DTE', 1: '1DTE', 7: '1W', 30: '1M' };
const magText = (mg) => (mg ? 'mag ' + fmtK(mg.strike) + ' ' + (mg.pct >= 0 ? '+' : '\u2212') + Math.abs(mg.pct).toFixed(1) + '%' : '');
const netText = (m, label) => 'Net ' + label + ' ' + fmtMoney(m.net);
function headHtml(api, label, locked) {
  return '<div class="stkgl-ch"><div class="stkgl-sym"><b>' + api + '</b><span>' + esc(label) + '</span>' + (locked ? '<i class="stkgl-pro">Pro</i>' : '') + '</div>' +
    '<div class="stkgl-spot"></div><div class="stkgl-mag" title="Magnet: the largest |GEX| strike within 5% of spot, and its distance from spot"></div>' +
    '<div class="stkgl-net" title="Net GEX for this expiry view, the same figure the GEX page shows"></div><div class="stkgl-reg"></div><div class="stkgl-lv" aria-label="Key levels"></div></div>';
}
function rowHtml(api, it) {
  return '<button type="button" class="stkgl-row" role="listitem" data-k="' + it.k + '" data-api="' + api + '"><span class="stkgl-k">' + fmtK(it.k) + '</span><span class="stkgl-tg"></span><span class="stkgl-v"></span></button>';
}
const OPT_API = 'https://book-recorder.theelitegrey.workers.dev/opt-analytics?u=';
const optCache = {};            // api -> { j, at, p }
function optFor(api, cb) {
  const e = optCache[api] || (optCache[api] = { j: null, at: 0, p: null });
  if (!e.p && Date.now() - e.at > 60000) {
    e.at = Date.now();
    e.p = fetch(OPT_API + api, { headers: { accept: 'application/json' } }).then((r) => (r.ok ? r.json() : null)).catch(() => null).then((j) => { if (j && !j.error) e.j = j; e.p = null; if (cb) cb(); return e.j; });
  }
  return e.j;
}
const numTxt = (v) => (isNum(v) ? v.toLocaleString('en-US', { maximumFractionDigits: 2 }) : '');
function chipsHtml(lv) {
  return lv.chips.map((c) => '<span class="stkgl-chip c-' + c.id + '" title="' + esc(c.tip) + '" tabindex="0"><i>' + esc(c.label) + '</i> ' + (c.value ? esc(c.value) : '<b>' + numTxt(c.price) + '</b>' + (c.pct != null ? ' <u>' + fmtPct(c.pct) + '</u>' : '')) + '</span>').join('');
}
// Sets one row's text / colour / class from an item; returns 1 up, -1 down, 0 unchanged (value change).
function patchRow(el, it) {
  const v = el._v || (el._v = el.querySelector('.stkgl-v'));
  const key = Math.round(it.g / 1e3);
  let dir = 0;
  if (el._g !== key) { if (el._g != null) dir = it.g > el._gv ? 1 : -1; el._g = key; el._gv = it.g; v.textContent = fmtMoney(it.g); }
  const bg = it.big ? MAX_FILL : cellColor(it.g, it.s);
  if (el._bg !== bg) { el._bg = bg; el.style.backgroundColor = bg; }
  if (el._big !== it.big) { el._big = it.big; el.classList.toggle('is-max', it.big); }
  return dir;
}
function flash(el, dir) {
  const c = dir > 0 ? 'flash-up' : 'flash-dn';
  el.classList.remove('flash-up', 'flash-dn'); void el.offsetWidth; el.classList.add(c);
  clearTimeout(el._ft); el._ft = setTimeout(() => el.classList.remove('flash-up', 'flash-dn'), 900);
}

// Plan: resolves {free:false} only when a signed-in Pro/admin is confirmed. A signed-out visitor never
// resolves (plan-limits waits for a sign-in), so the lock simply stays. Free -> {free:true}.
let planP = null;
function planTier() {
  if (planP) return planP;
  planP = new Promise((resolve) => {
    try { if (typeof window.strykerPlanTier === 'function') window.strykerPlanTier().then((r) => resolve(r || { free: true }), () => resolve({ free: true })); } catch (e) { resolve({ free: true }); }
  });
  return planP;
}

// Builds the ladder view into `root`. opts: { isPhone(), onPick(api, strike, data), replayNote(): string, dte(), dataFor(api) }
export function createLadder(root, opts) {
  opts = opts || {};
  let tier = null, tierAsked = false, tab = 'SPX', timer = 0, active = false, seq = 0, inflight = false;
  const live = {};                 // dte -> { SPX: data, ... } from the combined per-second endpoint
  const cols = {};                 // api -> { kind, sig, rows: Map(k -> el), list, spotEl, model, centered }
  let lastText = {}, netLabel = '0DTE', failed = 0;
  root.classList.add('stkgl-body');
  root.innerHTML = '<div class="stkgl-tabs" role="tablist" aria-label="Ladder market">' + COLS.map((c) => '<button type="button" role="tab" class="stkgl-tab" data-api="' + c[0] + '">' + c[0] + '</button>').join('') + '</div>' +
    '<div class="stkgl-note" hidden></div><div class="stkgl-cols">' + COLS.map((c) => '<section class="stkgl-col" data-api="' + c[0] + '" aria-label="' + c[0] + ' GEX ladder"></section>').join('') + '</div>' +
    '<p class="stkgl-foot"></p>';
  const tabsEl = root.querySelector('.stkgl-tabs'), note = root.querySelector('.stkgl-note'), foot = root.querySelector('.stkgl-foot');
  const colEl = (api) => root.querySelector('.stkgl-col[data-api="' + api + '"]');
  const phone = () => (opts.isPhone ? opts.isPhone() : window.innerWidth <= PHONE_MAX);
  // Default to the lock: QQQ / SPY open only once Pro is CONFIRMED (a signed-out or Free visitor never waits for it).
  const locked = (api) => api !== 'SPX' && !(tier && !tier.free);
  const dteNow = () => (opts.dte ? opts.dte() : 0);
  const dataFor = (api) => (opts.dataFor && opts.dataFor(api)) || (live[dteNow()] && live[dteNow()][api]) || gexCached(api, dteNow());

  tabsEl.addEventListener('click', (e) => { const b = e.target.closest('.stkgl-tab'); if (!b) return; tab = b.dataset.api; sync(); centerAll(true); });
  root.addEventListener('click', (e) => {
    const r = e.target.closest('.stkgl-row'); if (!r || !opts.onPick) return;
    const api = r.dataset.api, k = parseFloat(r.dataset.k);
    // the strike -> futures conversion needs the full levels response (futures ratio + basis), not the trimmed per-second one
    gexFetch(api, dteNow()).then((full) => opts.onPick(api, k, full && !full.error ? full : dataFor(api)));
  });
  function sync() {
    root.classList.toggle('is-phone', phone());
    tabsEl.querySelectorAll('.stkgl-tab').forEach((b) => { const on = b.dataset.api === tab; b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on)); });
    root.querySelectorAll('.stkgl-col').forEach((c) => c.classList.toggle('is-shown', !phone() || c.dataset.api === tab));
  }
  // Scroll target that puts the spot line in the middle of the list.
  const target = (st) => { const l = st.list; return Math.max(0, (st.model.pos + 0.5) * ROW_H - l.clientHeight / 2 + ROW_H / 2); };
  function centerCol(api, force) {
    const st = cols[api]; if (!st || st.kind !== 'list' || !st.list.clientHeight) return;
    if (force || st.centered) { st.list.scrollTop = target(st); st.centered = true; }
  }
  function centerAll(force) { requestAnimationFrame(() => Object.keys(cols).forEach((a) => centerCol(a, !!force))); }

  function setHeader(el, m, api, lv) {
    const s = el.querySelector('.stkgl-spot'), g = el.querySelector('.stkgl-mag'), n = el.querySelector('.stkgl-net');
    const st = m ? fmtSpot(m.spot) : '', mt = m ? magText(m.mg) : '', nt = m ? netText(m, netLabel) : '';
    if (s.textContent !== st) s.textContent = st;
    if (g.textContent !== mt) g.textContent = mt;
    if (n.textContent !== nt) { n.textContent = nt; n.classList.toggle('neg', !!m && m.net < 0); n.classList.toggle('pos', !!m && m.net >= 0); }
    const rg = el.querySelector('.stkgl-reg'), lvEl = el.querySelector('.stkgl-lv');
    const rt = lv && lv.regime ? lv.regime.text : '', ch = lv ? chipsHtml(lv) : '';
    if (rg.textContent !== rt) { rg.textContent = rt; rg.title = lv && lv.regime ? lv.regime.tip : ''; rg.className = 'stkgl-reg ' + (lv && lv.regime ? lv.regime.id : ''); }
    if (lvEl._h !== ch) { lvEl._h = ch; lvEl.innerHTML = ch; }
  }
  // Row tags (MP, FLIP, CW, PW, MAG, EM edges, spot arrow lives in .is-spot): one small tag per level on its nearest strike row.
  function applyTags(st, m, lv) {
    const by = new Map();
    if (lv) lv.tags.forEach((t) => { const i = rowNearest(m.rows, t.price); if (i < 0) return; const k = m.rows[i].k; (by.get(k) || by.set(k, []).get(k)).push(t); });
    st.rows.forEach((el, k) => {
      const ts = by.get(k) || [], h = ts.map((t) => '<em class="stkgl-t t-' + t.id + (t.faint ? ' faint' : '') + '" title="' + esc(t.short + ' ' + numTxt(t.price)) + '">' + esc(t.short) + '</em>').join('');
      if (el._tg !== h) { el._tg = h; el.querySelector('.stkgl-tg').innerHTML = h; el.dataset.lv = ts.map((t) => t.id).join(' '); }
    });
  }
  function paintCol(api, label, model, lock, rn, lv) {
    const el = colEl(api); let st = cols[api];
    if (rn || lock || !model) {
      const kind = rn ? 'note' : lock ? 'lock' : 'wait';
      if (st && st.kind === kind) return;
      cols[api] = { kind };
      el.innerHTML = headHtml(api, label, lock) + (rn ? '<div class="stkgl-empty">' + esc(rn) + '</div>' : lock ? '<div class="stkgl-lock"><p>' + api + ' ladder is part of Pro.</p><a class="btn btn-primary btn-sm" href="/#pricing">See Pro</a></div>' : '<div class="stkgl-empty">Loading…</div>');
      return;
    }
    if (!st || st.kind !== 'list' || st.sig !== model.sig) {
      // (re)build: only when the strike set changes (or first paint); keep the user's scroll unless centred on spot
      const keep = st && st.kind === 'list' ? { top: st.list.scrollTop, centered: st.centered } : { top: 0, centered: true };
      el.innerHTML = headHtml(api, label, false) + '<div class="stkgl-list" data-api="' + api + '" role="list">' + model.items.map((it) => rowHtml(api, it)).join('') + '<div class="stkgl-spotline" data-spot="1"></div></div>';
      const list = el.querySelector('.stkgl-list');
      st = cols[api] = { kind: 'list', sig: model.sig, list, rows: new Map(), centered: keep.centered, head: el.querySelector('.stkgl-ch'), spotEl: list.querySelector('.stkgl-spotline'), spotRow: null, model };
      list.querySelectorAll('.stkgl-row').forEach((r) => st.rows.set(parseFloat(r.dataset.k), r));
      list.addEventListener('scroll', () => { st.centered = Math.abs(list.scrollTop - target(st)) <= ROW_H * 1.5; }, { passive: true });
      model.items.forEach((it) => patchRow(st.rows.get(it.k), it));
      applySpot(st, model);
      if (keep.centered) centerCol(api, true); else list.scrollTop = keep.top;
      setHeader(st.head, model, api, lv);
      applyTags(st, model, lv);
      return;
    }
    // in-place patch: only rows whose value / colour changed are touched; no rebuild, no scroll jump
    st.model = model;
    model.items.forEach((it) => { const r = st.rows.get(it.k); const dir = patchRow(r, it); if (dir) flash(r, dir); });
    applySpot(st, model);
    setHeader(st.head, model, api, lv);
    applyTags(st, model, lv);
    if (st.centered) st.list.scrollTop = target(st);
  }
  function applySpot(st, m) {
    st.spotEl.style.top = Math.round((m.pos + 0.5) * ROW_H) + 'px';
    const nr = st.rows.get(m.rows[m.spotAt].k);
    if (st.spotRow !== nr) { if (st.spotRow) st.spotRow.classList.remove('is-spot'); nr.classList.add('is-spot'); st.spotRow = nr; }
  }
  function paintFoot(datas) {
    // the GEX snapshot's OWN build time (when we built it), never the delayed-futures stamp (CoS 2026-10-16)
    const times = datas.filter((d) => d && !d.error).map((d) => (isNum(d.built) ? d.built : isNum(d.fetched_at) ? d.fetched_at : dataTime(d))).filter(isNum);
    foot.textContent = (times.length ? updatedText(Math.min(...times)) + ' \u00b7 ' : '') + 'One colour scale across the three columns. Education only. Not financial advice.';
  }
  function paint() {
    sync();
    const rn = opts.replayNote ? opts.replayNote() : '';
    note.hidden = !rn; note.textContent = rn || '';
    const datas = COLS.map((c) => (locked(c[0]) ? null : dataFor(c[0])));
    const vmax = sharedScale(datas.map((d) => (d && !d.error ? ladderFromApi(d).filter((r) => !isNum(d.spot) || Math.abs(r.k - d.spot) <= d.spot * WINDOW_PCT) : [])));
    const models = datas.map((d) => (rn ? null : columnModel(d, vmax)));
    netLabel = DL[dteNow()] || '0DTE';
    const lvs = COLS.map((c, i) => (models[i] && datas[i] ? keyLevels(datas[i], models[i].spot, models[i].mg, optFor(c[0], () => { if (active) paint(); }), dteNow()) : null));
    COLS.forEach((c, i) => paintCol(c[0], c[1], models[i], locked(c[0]), rn, lvs[i]));
    paintFoot(datas);
    if (!rn) requestAnimationFrame(() => COLS.forEach((c) => { const st = cols[c[0]]; if (st && st.kind === 'list' && st.fresh !== true) { st.fresh = true; centerCol(c[0], true); } }));
  }
  // One combined poll (SPX / QQQ / SPY in a single request); falls back to the shared per-market fetch if it fails.
  async function poll() {
    if (inflight) return;
    if (opts.replayNote && opts.replayNote()) return;
    const dte = dteNow(), my = seq;
    let want = COLS.map((c) => c[0]).filter((a) => a === 'SPX' || (tier && !tier.free));
    if (opts.dataFor) want = want.filter((a) => !opts.dataFor(a));
    if (!want.length) return;
    inflight = true;
    try {
      const r = await fetch(LADDER_API + '?u=' + want.join(',') + '&dte=' + dte, { headers: { accept: 'application/json' }, cache: 'no-cache' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const text = await r.text();
      if (my !== seq) return;
      failed = 0;
      if (lastText[dte + want.join()] === text) return;      // unchanged: nothing to repaint
      lastText[dte + want.join()] = text;
      const j = JSON.parse(text);
      live[dte] = Object.assign(live[dte] || {}, Object.fromEntries(Object.entries(j.u || {}).filter(([, d]) => d && !d.error)));
      paint();
    } catch (e) {
      failed++;
      if (failed % 30 === 1) { await Promise.all(want.map((a) => gexFetch(a, dte))); if (my === seq) paint(); }
    } finally { inflight = false; }
  }
  function load() {
    paint();
    if (!tier && !tierAsked) { tierAsked = true; planTier().then((t) => { tier = t; paint(); poll(); }); }
    return poll();
  }
  function tick() {
    if (document.hidden) return;                  // hidden tab: no requests, no repaint
    paintFoot(COLS.map((c) => (locked(c[0]) ? null : dataFor(c[0]))));
    poll();
  }
  const onVis = () => { if (active && !document.hidden) { tick(); } };
  return {
    open() { active = true; seq++; lastText = {}; Object.keys(cols).forEach((k) => delete cols[k]); COLS.forEach((c) => { colEl(c[0]).innerHTML = ''; });
      load(); clearInterval(timer); timer = setInterval(tick, REFRESH_MS); document.addEventListener('visibilitychange', onVis); },
    close() { active = false; seq++; clearInterval(timer); timer = 0; document.removeEventListener('visibilitychange', onVis); },
    refresh() { if (active) { lastText = {}; paint(); poll(); } },
    relayout() { sync(); centerAll(false); },
    get isActive() { return active; }
  };
}

// ---- Charts: right-bar icon panel (phones: a sheet) ----------------------------------------------
const svg = (d, s) => '<svg width="' + (s || 18) + '" height="' + (s || 18) + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + '</svg>';
const IC_LADDER = '<path d="M5 4h14M5 9h9M5 14h12M5 19h6"/><path d="M19 17v4M17 19h4" />';
const IC_CLOSE = '<path d="M6 6l12 12M18 6L6 18"/>';
function el(tag, attrs, html) { const n = document.createElement(tag); for (const [k, v] of Object.entries(attrs || {})) { if (k === 'class') n.className = v; else n.setAttribute(k, v === true ? '' : v); } if (html) n.innerHTML = html; return n; }
const OTHERS = '.stkw-railbtn:not(.stkgl-railbtn), .stkw-phonebtn, .stknw-phonebtn, .stkin-phonebtn';

export function mountGexLadder(ws, opts) {
  opts = opts || {};
  if (!ws || document.getElementById('stkgl')) return null;
  const host = document.querySelector('.stkchart-panel.stkw-host') || document.querySelector('.stkchart-panel');
  if (!host) return null;
  const isPhone = () => window.innerWidth <= PHONE_MAX;
  let open = false;
  const railBtn = el('button', { type: 'button', class: 'stkw-railbtn stkgl-railbtn', title: 'GEX Ladder', 'aria-label': 'GEX Ladder', 'aria-pressed': 'false' }, svg(IC_LADDER));
  const closeBtn = el('button', { type: 'button', class: 'stkw-ib stkgl-close', title: 'Close', 'aria-label': 'Close GEX Ladder' }, svg(IC_CLOSE));
  const body = el('div', { class: 'stkgl-wrap' });
  const panel = el('aside', { class: 'stkgl', id: 'stkgl', 'aria-label': 'GEX Ladder', hidden: true });
  panel.appendChild(el('div', { class: 'stkgl-hd' }, '<span class="stkgl-title">GEX Ladder</span><span class="stkgl-sp"></span>'));
  panel.firstChild.appendChild(closeBtn); panel.appendChild(body); host.appendChild(panel);
  const phoneBtn = el('button', { type: 'button', class: 'stkc-btn stkgl-phonebtn', title: 'GEX Ladder', 'aria-label': 'GEX Ladder' }, svg(IC_LADDER, 16) + '<span class="stkc-btn-l">Ladder</span>');
  const barR = document.querySelector('#stkc-bar .stkc-bar-r');
  if (barR) { const nb = barR.querySelector('.stknw-phonebtn') || barR.querySelector('.stkw-phonebtn'); barR.insertBefore(phoneBtn, nb ? nb.nextSibling : barR.firstChild); }

  const activeSym = () => { try { return ws.active.symbol; } catch (e) { return ''; } };
  const replayOn = () => !!(window.__stkReplay && window.__stkReplay.on);
  const ladder = createLadder(body, {
    isPhone,
    replayNote: () => (replayOn() ? 'Bar replay is on. The ladder shows the current chain, so it is hidden here. The chart\u2019s GEX Levels follow the replay clock.' : ''),
    onPick(api, strike, data) {
      let provider = '';
      try { const r = ws.cell(ws.active.id).data.resolve(activeSym()); if (r) provider = r.provider; } catch (e) {}
      const src = gexSource(activeSym(), provider);
      if (!src || src.api !== api || !data) {
        const want = api === 'QQQ' ? 'NQ, MNQ or QQQ' : api === 'SPX' ? 'ES, MES or SPX' : 'SPY';
        if (opts.toast) opts.toast('Open a ' + want + ' chart to draw this ' + api + ' strike.');
        return;
      }
      const shift = src.fut ? gexAnchor(src.fut, data) : null;
      const price = convOf(data, src, shift)(strike);
      if (!isNum(price)) { if (opts.toast) opts.toast('No ' + (src.fut || api) + ' conversion in the GEX data right now.'); return; }
      const p2 = Math.round(price * 100) / 100;
      flashLevel(ws, p2, api + ' ' + fmtK(strike) + ' \u00b7 ' + p2.toLocaleString('en-US', { maximumFractionDigits: 2 }), strike && data && data.ladder && (data.ladder.find((x) => x.strike === strike) || {}).gex < 0 ? '#ee4276' : '#4fe3ac');
    }
  });
  const wlOpen = () => host.classList.contains('stkw-open');
  function closeOthers() {
    if (wlOpen()) { const b = document.querySelector('.stkw .stkw-close'); if (b) b.click(); }
    try { if (window.__stkNews && window.__stkNews.isOpen) window.__stkNews.close(); } catch (e) {}
    try { if (window.__stkSymInfo && window.__stkSymInfo.isOpen) window.__stkSymInfo.close(); } catch (e) {}
  }
  function setOpen(v) {
    open = !!v;
    if (open) closeOthers();
    panel.hidden = !open;
    host.classList.toggle('stkgl-open', open);
    document.documentElement.classList.toggle('stkgl-sheet', open && isPhone());
    railBtn.setAttribute('aria-pressed', String(open)); railBtn.classList.toggle('on', open); phoneBtn.classList.toggle('on', open);
    if (open) ladder.open(); else ladder.close();
    requestAnimationFrame(() => { try { window.dispatchEvent(new Event('resize')); } catch (e) {} if (open) ladder.relayout(); });
  }
  function placeRail() {
    const rail = document.querySelector('.stkw-rail'); if (!rail) return false;
    if (railBtn.parentNode !== rail) { const after = rail.querySelector('.stkin-railbtn') || rail.querySelector('.stknw-railbtn') || rail.querySelector('.stkw-railbtn'); rail.insertBefore(railBtn, after ? after.nextSibling : rail.firstChild); }
    return true;
  }
  if (!placeRail()) { const mo = new MutationObserver(() => { if (placeRail()) mo.disconnect(); }); mo.observe(host, { childList: true, subtree: true }); setTimeout(() => mo.disconnect(), 30000); }
  railBtn.addEventListener('click', () => setOpen(!open));
  phoneBtn.addEventListener('click', (e) => { e.stopPropagation(); setOpen(!open); });
  closeBtn.addEventListener('click', () => setOpen(false));
  document.addEventListener('click', (e) => { if (open && e.target.closest && e.target.closest(OTHERS)) setTimeout(() => setOpen(false), 0); }, true);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && open && isPhone()) setOpen(false); });
  window.addEventListener('resize', () => { document.documentElement.classList.toggle('stkgl-sheet', open && isPhone()); if (open) ladder.relayout(); }, { passive: true });
  try { ws.on('state:changed', () => { if (open) ladder.refresh(); }); } catch (e) {}
  const api = { open: () => setOpen(true), close: () => setOpen(false), get isOpen() { return open; } };
  window.__stkGexLadder = api;
  return api;
}

// ---- GEX page: a "Ladder" tab beside Chart / Heatmap -----------------------------------------------
export function mountGexPage() {
  const start = () => {
    const tabs = document.getElementById('gex-view-tabs'), chartCard = document.querySelector('.gex-chart-card');
    if (!tabs || !chartCard || document.getElementById('gex-ladder-card')) return !!document.getElementById('gex-ladder-card');
    const btn = el('button', { type: 'button', role: 'tab', class: 'gex-vtab', 'data-view': 'ladder', 'aria-selected': 'false' }); btn.textContent = 'Ladder';
    tabs.appendChild(btn);
    const card = el('section', { id: 'gex-ladder-card', class: 'gex-card gex-ladder-card', hidden: true });
    card.innerHTML = '<div class="gex-chart-head"><h2>GEX ladder</h2></div>';
    const body = el('div', { class: 'stkgl-wrap' }); card.appendChild(body);
    chartCard.parentNode.insertBefore(card, chartCard.nextSibling);
    // The page already holds the response for its selected market + expiry: use it for that market so the ladder's
    // Net equals the page's NET GEX (one number per page). Other columns use the shared cache.
    const pageData = (api) => { const g = window.strykerGexData; return g && g.u === api && g.data && !g.data.error ? g.data : null; };
    const ladder = createLadder(body, { isPhone: () => window.innerWidth <= PHONE_MAX, dataFor: pageData, dte: () => (window.strykerGexData ? window.strykerGexData.dte : 0) });
    window.addEventListener('stryker:gex-data', () => { if (ladder.isActive) ladder.refresh(); });
    tabs.addEventListener('click', (e) => {
      const b = e.target.closest('[data-view]'); if (!b) return;
      const on = b.getAttribute('data-view') === 'ladder';
      card.hidden = !on;
      if (on) { chartCard.hidden = true; const hc = document.getElementById('gex-heat-card'); if (hc) hc.hidden = true; ladder.open(); ladder.relayout(); } else ladder.close();
    });
    window.addEventListener('resize', () => { if (ladder.isActive) ladder.relayout(); }, { passive: true });
    window.__stkGexLadderPage = { ladder };
    return true;
  };
  if (start()) return;
  const mo = new MutationObserver(() => { if (start()) mo.disconnect(); });
  mo.observe(document.body, { childList: true, subtree: true });
  setTimeout(() => mo.disconnect(), 30000);
}
