// TradeZoro — GEX Ladder (Charts right-bar panel + GEX page tab) — ES module
// Owner order 2026-10-16 ("build all 4", point 1). Our own design.
//
// Depends on: assets/chart-gex-levels.js (gexFetch/gexCached: the SAME shared GEX fetch + 5-minute
// cache as the GEX Levels indicator, so the ladder adds no API calls; gexTier; convOf, gexAnchor,
// gexSource, flashLevel, agoText, dataTime), assets/chart-gex-ladder-core.js (pure ranking/format),
// assets/chart-watchlist.js (.stkw-rail, .stkchart-panel.stkw-host), assets/style.css (.stkgl-*).
//
// WHAT IT SHOWS: SPX, QQQ and SPY side by side (phones: tabs, one column at a time). Each column is a
// strike list centred on spot: strike + net GEX in dollars, a bar behind each row sized on ONE colour
// scale shared by all three columns (mint = positive, magenta = negative, muted = small), the single
// biggest |GEX| strike of each column outlined in violet with a "MAX" chip, a spot divider that the list
// scrolls to, and a header: symbol, spot, net GEX, the magnet strike + % distance.
// CHARTS: clicking a strike flashes a horizontal line at that strike's futures price (QQQ -> NQ/MNQ,
// SPX -> ES/MES, the same ratio + basis + re-anchor as the GEX Levels lines); on an SPX/SPY/QQQ chart the
// strike is used as is. A chart whose market does not match the column gets a short toast instead.
// PLAN: Free = SPX column only (QQQ / SPY show a "Pro" lock and are never fetched); Pro = all three.
// BAR REPLAY: the ladder is the current chain, so it says so and does not draw during replay.
// WORDING: "GEX updated X min ago" only; Education only. Not financial advice.
import { gexFetch, gexCached, gexTier, gexSource, gexAnchor, convOf, flashLevel, agoText, dataTime } from './chart-gex-levels.js?v=577';
import { ladderFromApi, sharedScale, strength, biggestIndex, magnet, netTotal, fmtMoney } from './chart-gex-ladder-core.js?v=577';

export const COLS = [['SPX', 'S&P 500'], ['QQQ', 'Nasdaq 100'], ['SPY', 'S&P 500 ETF']];
const PHONE_MAX = 700;
const POS = '3,201,136', NEG = '238,66,118';       // mint #03c988, magenta #ee4276 (the GEX heat ramps)
const REFRESH_MS = 60 * 1000;
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
  let spotAt = rows.findIndex((r) => r.k < spot);            // the divider goes before the first strike below spot
  if (spotAt < 0) spotAt = rows.length;
  return {
    rows, spot, spotAt, big, mg, net: isNum(data.net_gex) ? data.net_gex : netTotal(rows),
    items: rows.map((r, i) => ({ k: r.k, g: r.g, s: strength(r.g, vmax), big: i === big }))
  };
}

function colHtml(api, label, m, locked, nearSpot) {
  const head = '<div class="stkgl-ch"><div class="stkgl-sym"><b>' + api + '</b><span>' + esc(label) + '</span>' + (locked ? '<i class="stkgl-pro">Pro</i>' : '') + '</div>' +
    (m ? '<div class="stkgl-spot">' + fmtSpot(m.spot) + '</div>' +
      '<div class="stkgl-net ' + (m.net < 0 ? 'neg' : 'pos') + '" title="Net GEX, all strikes">Net ' + fmtMoney(m.net) + '</div>' +
      (m.mg ? '<div class="stkgl-mag" title="Largest |GEX| strike within 5% of spot">Magnet ' + fmtK(m.mg.strike) + ' · ' + (m.mg.pct >= 0 ? '+' : '\u2212') + Math.abs(m.mg.pct).toFixed(1) + '%</div>' : '') : '') + '</div>';
  if (locked) return head + '<div class="stkgl-lock"><p>' + api + ' ladder is part of Pro.</p><a class="btn btn-primary btn-sm" href="/#pricing">See Pro</a></div>';
  if (!m) return head + '<div class="stkgl-empty">Loading…</div>';
  let h = '<div class="stkgl-list" data-api="' + api + '" role="list">';
  m.items.forEach((it, i) => {
    if (i === m.spotAt) h += '<div class="stkgl-spotline" data-spot="1"><span>spot ' + fmtSpot(m.spot) + '</span></div>';
    const col = it.g < 0 ? NEG : POS, a = Math.min(0.55, 0.06 + it.s * 0.5);
    h += '<button type="button" class="stkgl-row' + (it.big ? ' is-max' : '') + (it.s < 0.12 ? ' is-small' : '') + (it.g < 0 ? ' neg' : ' pos') + '" role="listitem" data-k="' + it.k + '" data-api="' + api + '" ' +
      'style="background-image:linear-gradient(90deg,rgba(' + col + ',' + a.toFixed(3) + ') ' + (it.s * 100).toFixed(1) + '%,transparent ' + (it.s * 100).toFixed(1) + '%)" ' +
      'title="' + api + ' ' + fmtK(it.k) + ': net GEX ' + fmtMoney(it.g) + '"><span class="stkgl-k">' + fmtK(it.k) + '</span>' + (it.big ? '<em>MAX</em>' : '') + '<span class="stkgl-v">' + fmtMoney(it.g) + '</span></button>';
  });
  if (m.spotAt >= m.items.length) h += '<div class="stkgl-spotline" data-spot="1"><span>spot ' + fmtSpot(m.spot) + '</span></div>';
  return head + h + '</div>';
}

// Builds the ladder view into `root`. opts: { isPhone(), onPick(api, strike, data), replayNote(): string }
export function createLadder(root, opts) {
  opts = opts || {};
  let tier = null, tab = 'SPX', timer = 0, active = false, centered = {}, lastSig = '', seq = 0;
  root.classList.add('stkgl-body');
  root.innerHTML = '<div class="stkgl-tabs" role="tablist" aria-label="Ladder market">' + COLS.map((c) => '<button type="button" role="tab" class="stkgl-tab" data-api="' + c[0] + '">' + c[0] + '</button>').join('') + '</div>' +
    '<div class="stkgl-note" hidden></div><div class="stkgl-cols">' + COLS.map((c) => '<section class="stkgl-col" data-api="' + c[0] + '" aria-label="' + c[0] + ' GEX ladder"></section>').join('') + '</div>' +
    '<p class="stkgl-foot"></p>';
  const tabsEl = root.querySelector('.stkgl-tabs'), note = root.querySelector('.stkgl-note'), foot = root.querySelector('.stkgl-foot');
  const colEl = (api) => root.querySelector('.stkgl-col[data-api="' + api + '"]');
  const phone = () => (opts.isPhone ? opts.isPhone() : window.innerWidth <= PHONE_MAX);
  const locked = (api) => api !== 'SPX' && !!tier && !!tier.free;

  tabsEl.addEventListener('click', (e) => { const b = e.target.closest('.stkgl-tab'); if (!b) return; tab = b.dataset.api; sync(); centerAll(); });
  root.addEventListener('click', (e) => {
    const r = e.target.closest('.stkgl-row'); if (!r || !opts.onPick) return;
    const api = r.dataset.api; opts.onPick(api, parseFloat(r.dataset.k), gexCached(api, 0));
  });
  function sync() {
    root.classList.toggle('is-phone', phone());
    tabsEl.querySelectorAll('.stkgl-tab').forEach((b) => { const on = b.dataset.api === tab; b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on)); });
    root.querySelectorAll('.stkgl-col').forEach((c) => c.classList.toggle('is-shown', !phone() || c.dataset.api === tab));
  }
  function centerAll() {
    requestAnimationFrame(() => root.querySelectorAll('.stkgl-list').forEach((l) => {
      const s = l.querySelector('[data-spot]'); if (!s) return;
      l.scrollTop = Math.max(0, s.offsetTop - l.clientHeight / 2 + s.offsetHeight / 2);
      centered[l.dataset.api] = true;
    }));
  }
  function paint() {
    sync();
    const rn = opts.replayNote ? opts.replayNote() : '';
    note.hidden = !rn; note.textContent = rn || '';
    const datas = COLS.map((c) => (locked(c[0]) ? null : gexCached(c[0], 0)));
    const vmax = sharedScale(datas.map((d) => (d && !d.error ? ladderFromApi(d) : [])));
    const models = datas.map((d) => (rn ? null : columnModel(d, vmax)));
    const times = datas.filter((d) => d && !d.error).map(dataTime).filter(isNum);
    const sig = JSON.stringify([rn, tier && tier.free, models.map((m) => m && [m.spot, m.net, m.items.length, m.items.map((i) => Math.round(i.g / 1e4)).join(',')])]);
    foot.textContent = (times.length ? agoText(Math.min(...times)) + ' · ' : '') + 'One colour scale across the three columns. Education only. Not financial advice.';
    if (sig === lastSig) return;
    lastSig = sig;
    COLS.forEach((c, i) => {
      const el = colEl(c[0]), prev = el.querySelector('.stkgl-list'), top = prev ? prev.scrollTop : 0;
      el.innerHTML = rn ? '<div class="stkgl-empty">' + esc(rn) + '</div>' : colHtml(c[0], c[1], models[i], locked(c[0]));
      const l = el.querySelector('.stkgl-list');
      if (l && centered[c[0]]) l.scrollTop = top;
    });
    if (!rn && COLS.some((c) => !centered[c[0]] && models[COLS.findIndex((x) => x[0] === c[0])])) centerAll();
  }
  async function load() {
    const my = ++seq;
    paint();
    if (!tier) { gexTier().then((t) => { tier = t; paint(); load(); }); }
    if (opts.replayNote && opts.replayNote()) return;
    const want = COLS.map((c) => c[0]).filter((a) => a === 'SPX' || (tier && !tier.free));
    await Promise.all(want.map((a) => gexFetch(a, 0)));
    if (my === seq) paint();
  }
  return {
    open() { active = true; centered = {}; lastSig = ''; load(); clearInterval(timer); timer = setInterval(() => { if (!document.hidden) load(); else paint(); }, REFRESH_MS); },
    close() { active = false; clearInterval(timer); timer = 0; },
    refresh() { if (active) load(); },
    relayout() { sync(); centerAll(); },
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
    const ladder = createLadder(body, { isPhone: () => window.innerWidth <= PHONE_MAX });
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
