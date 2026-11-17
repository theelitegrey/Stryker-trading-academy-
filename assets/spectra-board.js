// TradeZoro — Spectra board UI (ES module). Owner order 2026-11-17 (roadmap card "spectra"). Our own design.
// One component used twice: the /spectra page (assets/spectra-page.js) and the Charts right-bar panel (assets/chart-spectra.js).
// Shows a strike x expiry board of net dealer exposure (GEX = gamma, VEX = vanna) with the Apex (biggest node), floor and
// ceiling, a velocity view (each cell growing / shrinking over 1m .. 1d), a right-click / long-press alert menu and the Trio
// agreement view (SPX, SPY, QQQ). Maths: assets/spectra-core.js. Styles: assets/spectra.css (loaded here, once).
// DATA: GET /api/zo/board?u=SYM[&vs=seconds] with the member's Firebase ID token (free for signed-in members; the API and the
//   Worker check the token). Copy rules: "Updated X s ago" only. Education only. Not financial advice.
import * as S from './spectra-core.js?v=1110';
import * as ProGate from './chart-pro-gate.js?v=1110';

const API = '/api/zo/board';
const POLL_MS = 30000;
const LONG_PRESS_MS = 500;
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const theme = () => (document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark');
const rgb = (a) => 'rgb(' + a.join(',') + ')';
const ICON = '/assets/images/spectra/spectra-20';
export const iconImg = (sz) => '<img class="spx-ic" src="' + ICON + '.png" srcset="' + ICON + '@2x.png 2x" width="' + (sz || 20) + '" height="' + (sz || 20) + '" alt="" aria-hidden="true" decoding="async">';

export function loadCss() {
  if (document.getElementById('spx-css')) return;
  const l = document.createElement('link'); l.id = 'spx-css'; l.rel = 'stylesheet'; l.href = '/assets/spectra.css?v=1110';
  document.head.appendChild(l);
}

// ---- auth + data ------------------------------------------------------------------------------
function fbAuth() { try { return window.firebase && window.firebase.auth ? window.firebase.auth() : null; } catch (e) { return null; } }
let authP = null;
function authUser() {
  if (authP) return authP;
  authP = new Promise((res) => {
    const a = fbAuth(); if (!a) { res(null); return; }
    if (a.currentUser) { res(a.currentUser); return; }
    const t = setTimeout(() => res(a.currentUser || null), 15000);
    try { const off = a.onAuthStateChanged((u) => { clearTimeout(t); off(); res(u || null); }); } catch (e) { clearTimeout(t); res(null); }
  });
  authP.then((u) => { if (!u) authP = null; });   // ask again later (sign-in after load)
  return authP;
}
async function headers() {
  const u = await authUser();
  if (!u || u.isAnonymous) return null;
  try { return { authorization: 'Bearer ' + (await u.getIdToken()) }; } catch (e) { return null; }
}
const cache = new Map();   // u|vs -> { at, body | err }
export async function fetchBoard(u, vs, force) {
  const k = u + '|' + (vs || 0), e = cache.get(k);
  if (!force && e && Date.now() - e.at < 15000) return e;
  const h = await headers();
  if (!h) { const r = { at: Date.now(), err: 'signin' }; cache.set(k, r); return r; }
  let r;
  try {
    const res = await fetch(API + '?u=' + encodeURIComponent(u) + (vs ? '&vs=' + vs : ''), { headers: Object.assign({ accept: 'application/json' }, h) });
    if (res.status === 200) r = { at: Date.now(), body: await res.json() };
    else r = { at: Date.now(), err: res.status === 403 ? 'signin' : res.status === 404 ? 'nodata' : 'down' };
  } catch (err) { r = { at: Date.now(), err: 'down' }; }
  cache.set(k, r);
  return r;
}
const ERR_TEXT = { signin: 'Sign in to use Spectra. It is free for members.', nodata: 'No board for this market yet. It fills in during the options session.', down: 'Spectra could not load. It will try again shortly.' };

// ---- firestore (alerts) --------------------------------------------------------------------------
function db() { try { return window.firebase.firestore(); } catch (e) { return null; } }
async function writeAlert(coll, doc) {
  const u = await authUser(), d = db();
  if (!u || u.isAnonymous || !d) throw Object.assign(new Error('signin'), { signin: true });
  const ts = window.firebase.firestore.FieldValue.serverTimestamp();
  await d.collection('students').doc(u.uid).collection(coll).doc().set(Object.assign({}, doc, { createdAt: ts, updatedAt: ts }));
}

// ---- the component -----------------------------------------------------------------------------
// opts: { compact (panel), ticker, onPick(u, strike, body) (Charts: draw the line), addPriceAlert(doc) (Charts: chart-alerts),
//         chartSymbol() (Charts: symbol for price alerts), toast(msg), store (localStorage key prefix) }
export function createSpectra(root, opts) {
  opts = opts || {};
  loadCss();
  const KEY = (opts.store || 'spx') + ':';
  const saved = (k, d) => { try { const v = localStorage.getItem(KEY + k); return v == null ? d : v; } catch (e) { return d; } };
  const save = (k, v) => { try { localStorage.setItem(KEY + k, v); } catch (e) {} };
  const st = {
    u: S.TICKERS.some(([t]) => t === opts.ticker) ? opts.ticker : saved('u', 'SPX'),
    view: saved('view', 'gex') === 'vex' ? 'vex' : 'gex',
    tab: 'board', vel: saved('vel', '0') === '1', vs: Number(saved('vs', '300')) || 300,
    body: null, err: null, prev: null, active: false, timer: 0, tick: 0, model: null, seq: 0
  };
  if (!S.WINDOWS.some(([s]) => s === st.vs)) st.vs = 300;
  const toast = (m) => { if (opts.toast) opts.toast(m); else if (window.showToast) window.showToast(m); };
  const tid = 'spx' + Math.random().toString(36).slice(2, 7);

  root.classList.add('spx'); if (opts.compact) root.classList.add('spx--compact');
  root.innerHTML =
    '<div class="spx-bar">' +
      '<div class="spx-row">' +
        '<div class="spx-seg spx-tk" role="radiogroup" aria-label="Market">' + S.TICKERS.map(([t, name]) => '<button type="button" role="radio" data-u="' + t + '" title="' + esc(name) + '">' + t + '</button>').join('') + '</div>' +
        '<label class="spx-find"><span class="spx-sr">Find a market</span><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/></svg>' +
          '<input type="search" placeholder="Search" autocomplete="off" spellcheck="false" aria-controls="' + tid + '-l" aria-autocomplete="list"></label>' +
        '<ul class="spx-list" id="' + tid + '-l" role="listbox" hidden></ul>' +
      '</div>' +
      '<div class="spx-row">' +
        '<div class="spx-seg spx-view" role="radiogroup" aria-label="Exposure"><button type="button" role="radio" data-v="gex" title="' + esc(S.VIEWS.gex.note) + '">GEX</button><button type="button" role="radio" data-v="vex" title="' + esc(S.VIEWS.vex.note) + '">VEX</button></div>' +
        '<div class="spx-seg spx-tab" role="tablist" aria-label="View"><button type="button" role="tab" data-t="board">Board</button><button type="button" role="tab" data-t="trio">Trio</button></div>' +
        '<button type="button" class="spx-chip spx-velb" aria-pressed="false" title="Show which nodes are growing or shrinking"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 14l5-5 5 5"/></svg>Velocity</button>' +
      '</div>' +
      '<div class="spx-row spx-wins" hidden><span class="spx-lab">Compare with</span><div class="spx-seg spx-win" role="radiogroup" aria-label="Velocity window">' + S.WINDOWS.map(([s, l]) => '<button type="button" role="radio" data-s="' + s + '">' + l + '</button>').join('') + '</div></div>' +
    '</div>' +
    '<div class="spx-keys" aria-live="polite"></div>' +
    '<div class="spx-main"><div class="spx-scroll" tabindex="0" aria-label="Spectra board. Arrow keys move, Enter or the menu key opens alerts."></div><div class="spx-trio" hidden></div><div class="spx-msg" hidden></div></div>' +
    '<div class="spx-foot"><span class="spx-upd" role="status">Loading</span><span class="spx-dot" aria-hidden="true">\u00b7</span><span class="spx-edu">Education only. Not financial advice.</span></div>' +
    '<div class="spx-menu" role="menu" hidden></div>';
  const $ = (s) => root.querySelector(s);
  const scroll = $('.spx-scroll'), trioEl = $('.spx-trio'), msg = $('.spx-msg'), keys = $('.spx-keys'), upd = $('.spx-upd'), menu = $('.spx-menu');
  const find = $('.spx-find input'), list = $('.spx-list');

  // ---- controls ----
  function syncControls() {
    root.querySelectorAll('.spx-tk [data-u]').forEach((b) => { const on = b.dataset.u === st.u; b.setAttribute('aria-checked', String(on)); b.tabIndex = on ? 0 : -1; b.classList.toggle('on', on); b.classList.toggle('lock', ProGate.isFree() && b.dataset.u !== 'SPX'); });
    root.querySelectorAll('.spx-view [data-v]').forEach((b) => { const on = b.dataset.v === st.view; b.setAttribute('aria-checked', String(on)); b.classList.toggle('on', on); });
    root.querySelectorAll('.spx-tab [data-t]').forEach((b) => { const on = b.dataset.t === st.tab; b.setAttribute('aria-selected', String(on)); b.classList.toggle('on', on); });
    root.querySelectorAll('.spx-win [data-s]').forEach((b) => { const on = Number(b.dataset.s) === st.vs; b.setAttribute('aria-checked', String(on)); b.classList.toggle('on', on); });
    const vb = $('.spx-velb'); vb.setAttribute('aria-pressed', String(st.vel)); vb.classList.toggle('on', st.vel); vb.disabled = st.tab !== 'board';
    $('.spx-wins').hidden = !(st.vel && st.tab === 'board');
    root.dataset.view = st.view; root.dataset.tab = st.tab;
  }
  function setTicker(u, focus) {
    if (!S.TICKERS.some(([t]) => t === u)) return false;
    if (ProGate.isFree() && u !== 'SPX') { ProGate.upgrade('gex'); return false; }   // the GEX Ladder rule: free = SPX only
    if (u !== st.u) { st.u = u; save('u', u); st.body = null; st.prev = null; syncControls(); load(true); }
    if (focus) { const b = root.querySelector('.spx-tk [data-u="' + u + '"]'); if (b) b.focus(); }
    return true;
  }
  root.querySelector('.spx-tk').addEventListener('click', (e) => { const b = e.target.closest('[data-u]'); if (b) setTicker(b.dataset.u); });
  root.querySelector('.spx-tk').addEventListener('keydown', (e) => {
    const i = S.TICKERS.findIndex(([t]) => t === st.u), n = S.TICKERS.length;
    const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    for (let j = 1; j <= n; j++) { const u = S.TICKERS[(i + d * j + n * 4) % n][0]; if (!ProGate.isFree() || u === 'SPX') { setTicker(u, true); break; } }
  });
  root.querySelector('.spx-view').addEventListener('click', (e) => { const b = e.target.closest('[data-v]'); if (b && b.dataset.v !== st.view) { st.view = b.dataset.v; save('view', st.view); syncControls(); render(); } });
  root.querySelector('.spx-tab').addEventListener('click', (e) => { const b = e.target.closest('[data-t]'); if (b && b.dataset.t !== st.tab) { st.tab = b.dataset.t; syncControls(); render(); if (st.tab === 'trio') loadTrio(); } });
  $('.spx-velb').addEventListener('click', () => { st.vel = !st.vel; save('vel', st.vel ? '1' : '0'); syncControls(); if (st.vel) loadPrev(true); else render(); });
  root.querySelector('.spx-win').addEventListener('click', (e) => { const b = e.target.closest('[data-s]'); if (b) { st.vs = Number(b.dataset.s); save('vs', String(st.vs)); syncControls(); loadPrev(true); } });

  // search: type to filter, arrows to move, Enter to open
  let li = -1;
  const matches = () => { const q = find.value.trim().toUpperCase(); return S.TICKERS.filter(([t, n]) => !q || t.includes(q) || n.toUpperCase().includes(q)); };
  function drawList() {
    const m = matches(); li = Math.min(Math.max(li, 0), m.length - 1);
    list.innerHTML = m.length ? m.map(([t, n], i) => '<li role="option" id="' + tid + '-o' + i + '" data-u="' + t + '" aria-selected="' + (i === li) + '"><b>' + t + '</b><span>' + esc(n) + '</span></li>').join('') : '<li class="spx-none" role="option" aria-disabled="true">No match. Spectra covers ' + S.TICKERS.map(([t]) => t).join(', ') + '.</li>';
    list.hidden = false; find.setAttribute('aria-expanded', 'true');
    if (m.length) find.setAttribute('aria-activedescendant', tid + '-o' + li); else find.removeAttribute('aria-activedescendant');
  }
  const closeList = () => { list.hidden = true; find.setAttribute('aria-expanded', 'false'); };
  find.addEventListener('focus', () => { li = 0; drawList(); });
  find.addEventListener('input', () => { li = 0; drawList(); });
  find.addEventListener('blur', () => setTimeout(closeList, 150));
  find.addEventListener('keydown', (e) => {
    const m = matches();
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); li = (li + (e.key === 'ArrowDown' ? 1 : -1) + m.length) % Math.max(1, m.length); drawList(); }
    else if (e.key === 'Enter') { e.preventDefault(); if (m[li]) { setTicker(m[li][0]); find.value = ''; closeList(); find.blur(); } }
    else if (e.key === 'Escape') { find.value = ''; closeList(); find.blur(); }
  });
  list.addEventListener('mousedown', (e) => { const o = e.target.closest('[data-u]'); if (o) { e.preventDefault(); setTicker(o.dataset.u); find.value = ''; closeList(); find.blur(); } });

  // ---- loading ----
  async function load(force) {
    const my = ++st.seq;
    if (!st.body) { upd.textContent = 'Loading'; }
    const r = await fetchBoard(st.u, 0, force);
    if (my !== st.seq) return;
    st.err = r.err || null;
    if (r.body) st.body = r.body;
    if (st.vel) await loadPrev(false, my); else render();
  }
  async function loadPrev(force, my) {
    my = my || st.seq;
    const r = await fetchBoard(st.u, st.vs, force);
    if (my !== st.seq) return;
    st.prev = r.body ? r.body.prev || null : null;
    st.prevNote = r.body ? (r.body.prev ? '' : 'No board from that far back yet.') : '';
    render();
  }
  const trio = new Map();
  async function loadTrio() {
    await Promise.all(S.TRIO.map(async (u) => { if (ProGate.isFree() && u !== 'SPX') return; const r = await fetchBoard(u, 0, false); trio.set(u, r); }));
    if (st.tab === 'trio') render();
  }

  // ---- render ----
  function render() {
    syncControls();
    upd.textContent = st.body ? S.updatedText(st.body.t) : st.err ? 'Not loaded' : 'Loading';
    if (st.tab === 'trio') { scroll.hidden = true; keys.hidden = true; msg.hidden = true; trioEl.hidden = false; renderTrio(); return; }
    trioEl.hidden = true; keys.hidden = false;
    const m = st.model = S.boardModel(st.body, st.view);
    if (!m) {
      scroll.hidden = true; msg.hidden = false; keys.innerHTML = '';
      msg.textContent = st.err ? ERR_TEXT[st.err] : st.body ? 'This board has no data.' : 'Loading the board\u2026';
      return;
    }
    msg.hidden = true; scroll.hidden = false;
    const top = S.topNode(m), fc = S.floorCeiling(m), si = S.spotRow(m), vmax = S.maxAbs(m), th = theme();
    const vel = st.vel ? S.velocity(m, st.prev, st.view) : null;
    const tag = (ri, ci) => {
      const t = [];
      if (top && top.ri === ri && top.ci === ci) t.push('apex');
      if (fc.floor && fc.floor.ri === ri && fc.floor.ci === ci) t.push('floor');
      if (fc.ceiling && fc.ceiling.ri === ri && fc.ceiling.ci === ci) t.push('ceil');
      return t;
    };
    let h = '<table class="spx-board" role="grid" aria-label="' + esc(st.u + ' ' + S.VIEWS[st.view].name + ', ' + S.VIEWS[st.view].unit) + '"><thead><tr><th scope="col" class="spx-kh">Strike</th>';
    m.cols.forEach((c) => { h += '<th scope="col"><span class="spx-cd">' + esc(c.label.date) + '</span>' + (c.tag ? '<span class="spx-ct">' + esc(c.tag) + '</span>' : '') + '</th>'; });
    h += '</tr></thead><tbody>';
    m.rows.forEach((r, ri) => {
      const spot = ri === si;
      h += '<tr' + (spot ? ' class="spx-spot"' : '') + '><th scope="row" class="spx-k" data-r="' + ri + '"><button type="button" tabindex="-1" data-k="' + r.k + '" title="' + (opts.onPick ? 'Draw this strike on the chart' : 'Strike ' + S.fmtK(r.k)) + '">' + S.fmtK(r.k) + '</button>' + (spot ? '<span class="spx-sp" title="Spot ' + esc(String(m.spot)) + '">Spot</span>' : '') + '</th>';
      r.cells.forEach((v, ci) => {
        const c = S.cellColor(v, vmax, th), tg = tag(ri, ci), vv = vel ? vel[ri][ci] : null;
        const lab = tg.includes('apex') ? 'Apex' : tg.includes('floor') ? 'Floor' : tg.includes('ceil') ? 'Ceiling' : '';
        let title = S.fmtK(r.k) + ' \u00b7 ' + m.cols[ci].label.date + ' \u00b7 ' + S.fmtMoney(v) + ' ' + S.VIEWS[st.view].unit;
        if (lab) title = lab + ': ' + title;
        if (vv && vv.dir != null) title += ' \u00b7 ' + (vv.dir > 0 ? 'growing' : vv.dir < 0 ? 'shrinking' : 'steady') + (isNum(vv.pct) ? ' (' + (vv.pct >= 0 ? '+' : '\u2212') + Math.abs(vv.pct).toFixed(0) + '%)' : '');
        h += '<td tabindex="-1" data-r="' + ri + '" data-c="' + ci + '" class="' + tg.map((t) => 'is-' + t).join(' ') + '" style="background:' + rgb(c) + ';color:' + S.inkOn(c) + '" title="' + esc(title) + '">' +
          (tg.includes('apex') ? '<i class="spx-star" aria-hidden="true">\u2605</i>' : '') +
          '<span class="spx-v">' + S.fmtMoney(v) + '</span>' +
          (lab && !tg.includes('apex') ? '<i class="spx-tag" aria-hidden="true">' + lab[0] + '</i>' : '') +
          (vv && vv.dir ? '<i class="spx-vel ' + (vv.dir > 0 ? 'up' : 'dn') + '" aria-hidden="true"></i>' : '') + '</td>';
      });
      h += '</tr>';
    });
    h += '</tbody></table>';
    const keep = { x: scroll.scrollLeft, y: scroll.scrollTop, first: !scroll.firstChild || scroll.dataset.u !== st.u + st.view };
    scroll.innerHTML = h; scroll.dataset.u = st.u + st.view;
    if (keep.first) centerSpot(); else { scroll.scrollLeft = keep.x; scroll.scrollTop = keep.y; }
    // key line: Apex, floor, ceiling (follows the view)
    const kc = (cls, name, n) => (n ? '<span class="spx-key ' + cls + '"><b>' + name + '</b>' + S.fmtK(n.k) + ' \u00b7 ' + esc(m.cols[n.ci].label.date) + ' \u00b7 ' + S.fmtMoney(n.v) + '</span>' : '');
    keys.innerHTML = kc('k-apex', '\u2605 Apex', top) + kc('k-floor', '<i class="spx-tag" aria-hidden="true">F</i>Floor', fc.floor) + kc('k-ceil', '<i class="spx-tag" aria-hidden="true">C</i>Ceiling', fc.ceiling) +
      (st.vel ? '<span class="spx-key k-vel">' + (st.prev ? '<i class="spx-vel up"></i>growing <i class="spx-vel dn"></i>shrinking vs ' + new Date(st.prev.t * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : esc(st.prevNote || 'Loading the earlier board\u2026')) + '</span>' : '');
  }
  function centerSpot() {
    const r = scroll.querySelector('.spx-spot');
    if (!r) return;
    scroll.scrollTop = Math.max(0, r.offsetTop - scroll.clientHeight / 2 + r.offsetHeight / 2);
  }
  function renderTrio() {
    const cards = S.TRIO.map((u) => {
      const r = trio.get(u), m = r && r.body ? S.boardModel(r.body, st.view) : null;
      return { u, m, err: r ? r.err : null, top: S.topNode(m), fc: S.floorCeiling(m), lean: S.leanOf(m), locked: ProGate.isFree() && u !== 'SPX' };
    });
    const ag = S.agreement(cards.map((c) => c.lean));
    const lean = { up: ['Above spot', 'up'], down: ['Below spot', 'dn'], flat: ['At spot', 'flat'] };
    const row = (name, n, m) => '<div class="spx-tr"><span>' + name + '</span><b>' + (n ? S.fmtK(n.k) : '\u2014') + '</b><em>' + (n ? S.fmtMoney(n.v) + ' \u00b7 ' + esc(m.cols[n.ci].label.date) : '') + '</em></div>';
    trioEl.innerHTML = '<div class="spx-agree' + (ag ? ' a-' + ag : '') + '"><span class="spx-badge">' + (ag ? S.AGREE_TEXT[ag] : 'Waiting') + '</span><p>' +
      (ag ? 'Where each market\u2019s ' + S.VIEWS[st.view].short + ' Apex sits against its own spot. ' + (ag === 'agree' ? 'All three point the same way.' : ag === 'mixed' ? 'Two of three point the same way.' : 'They point different ways.') : 'Loading SPX, SPY and QQQ.') + '</p></div>' +
      '<div class="spx-cards">' + cards.map((c) => '<section class="spx-card" data-u="' + c.u + '"><header><h3>' + c.u + '</h3>' +
        (c.lean ? '<span class="spx-lean l-' + lean[c.lean][1] + '">' + lean[c.lean][0] + '</span>' : '') + '</header>' +
        (c.locked ? '<p class="spx-cm">Members on a paid plan see ' + c.u + ' here.</p>' : !c.m ? '<p class="spx-cm">' + esc(c.err ? ERR_TEXT[c.err] : 'Loading\u2026') + '</p>' :
          '<div class="spx-tr spx-tsp"><span>Spot</span><b>' + S.fmtK(c.m.spot) + '</b><em>' + esc(S.updatedText(c.m.t)) + '</em></div>' + row('\u2605 Apex', c.top, c.m) + row('Floor', c.fc.floor, c.m) + row('Ceiling', c.fc.ceiling, c.m)) +
        '</section>').join('') + '</div>';
  }

  // ---- cell interaction: click (draw on chart), right-click / long-press / keyboard -> alert menu ----
  function cellAt(td) { const m = st.model; if (!m || !td) return null; const ri = +td.dataset.r, ci = +td.dataset.c; const r = m.rows[ri]; return r ? { ri, ci, k: r.k, x: m.cols[ci].x, v: r.cells[ci], col: m.cols[ci] } : null; }
  scroll.addEventListener('click', (e) => {
    const kb = e.target.closest('.spx-k button'), td = e.target.closest('td');
    const k = kb ? Number(kb.dataset.k) : td ? (cellAt(td) || {}).k : null;
    if (td) focusCell(td);
    if (isNum(k) && opts.onPick) opts.onPick(st.u, k, st.body);
  });
  scroll.addEventListener('contextmenu', (e) => { const td = e.target.closest('td'); if (!td) return; e.preventDefault(); focusCell(td); openMenu(td, e.clientX, e.clientY); });
  let lp = null;
  scroll.addEventListener('touchstart', (e) => {
    const td = e.target.closest('td'); if (!td || e.touches.length !== 1) return;
    const t = e.touches[0], x = t.clientX, y = t.clientY;
    lp = { x, y, tm: setTimeout(() => { lp = null; focusCell(td); openMenu(td, x, y); try { navigator.vibrate && navigator.vibrate(10); } catch (er) {} }, LONG_PRESS_MS) };
  }, { passive: true });
  const lpCancel = (e) => { if (!lp) return; if (e && e.touches && e.touches[0] && Math.hypot(e.touches[0].clientX - lp.x, e.touches[0].clientY - lp.y) < 10) return; clearTimeout(lp.tm); lp = null; };
  scroll.addEventListener('touchmove', lpCancel, { passive: true });
  scroll.addEventListener('touchend', () => lpCancel(), { passive: true });
  scroll.addEventListener('touchcancel', () => lpCancel(), { passive: true });
  function focusCell(td) { scroll.querySelectorAll('td.is-focus').forEach((x) => x.classList.remove('is-focus')); td.classList.add('is-focus'); try { td.focus({ preventScroll: true }); } catch (e) {} }
  scroll.addEventListener('keydown', (e) => {
    if (!st.model) return;
    let td = scroll.querySelector('td.is-focus');
    if (!td) { if (/^Arrow|Enter/.test(e.key)) { e.preventDefault(); const si = Math.max(0, S.spotRow(st.model)); td = scroll.querySelector('td[data-r="' + si + '"][data-c="0"]'); if (td) { focusCell(td); td.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } } return; }
    const r = +td.dataset.r, c = +td.dataset.c;
    const mv = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[e.key];
    if (mv) { e.preventDefault(); const n = scroll.querySelector('td[data-r="' + (r + mv[0]) + '"][data-c="' + (c + mv[1]) + '"]'); if (n) { focusCell(n); n.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } }
    else if (e.key === 'Enter' || e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) { e.preventDefault(); const b = td.getBoundingClientRect(); openMenu(td, b.left + b.width / 2, b.bottom); }
  });

  // the menu
  let menuCell = null;
  function openMenu(td, x, y) {
    const c = cellAt(td); if (!c) return;
    menuCell = c;
    const lbl = st.u + ' ' + S.fmtK(c.k) + ' \u00b7 ' + c.col.label.date + ' \u00b7 ' + S.VIEWS[st.view].short + ' ' + S.fmtMoney(c.v);
    menu.innerHTML = '<div class="spx-mh">' + esc(lbl) + '</div>' +
      '<button type="button" role="menuitem" data-a="near"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>Alert when price nears</button>' +
      '<button type="button" role="menuitem" data-a="touch"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12h18"/><circle cx="12" cy="12" r="3"/></svg>Alert when price touches</button>' +
      '<div class="spx-mnode" role="group" aria-label="Node size alert"><span>Alert when this node</span>' +
        '<div class="spx-seg spx-gs" role="radiogroup" aria-label="Direction"><button type="button" role="radio" data-d="grow" aria-checked="true" class="on">grows</button><button type="button" role="radio" data-d="shrink" aria-checked="false">shrinks</button></div>' +
        '<label class="spx-pct"><span>by</span><input type="number" min="1" max="1000" step="1" value="25" inputmode="numeric" aria-label="Percent"><span>%</span></label>' +
        '<button type="button" role="menuitem" class="spx-mgo" data-a="node">Create</button></div>' +
      '<p class="spx-mfoot">Alerts reach this device and your phone through your notification settings.</p>';
    menu.hidden = false;
    const host = root.getBoundingClientRect(), mw = menu.offsetWidth, mh = menu.offsetHeight;
    const vw = window.innerWidth, vh = window.innerHeight;
    let left = Math.min(Math.max(8, x), vw - mw - 8), topY = y + mh + 8 > vh ? Math.max(8, y - mh) : y;
    menu.style.left = (left - host.left) + 'px'; menu.style.top = (topY - host.top) + 'px';
    const first = menu.querySelector('[role=menuitem]'); if (first) first.focus();
  }
  function closeMenu() { if (menu.hidden) return; menu.hidden = true; menuCell = null; const f = scroll.querySelector('td.is-focus'); if (f) try { f.focus({ preventScroll: true }); } catch (e) {} }
  menu.addEventListener('click', async (e) => {
    const d = e.target.closest('[data-d]');
    if (d) { menu.querySelectorAll('[data-d]').forEach((b) => { const on = b === d; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); }); return; }
    const a = e.target.closest('[data-a]'); if (!a || !menuCell) return;
    const c = menuCell, body = st.body;
    try {
      if (a.dataset.a === 'node') {
        const dir = (menu.querySelector('[data-d].on') || {}).dataset.d || 'grow', pct = Number(menu.querySelector('.spx-pct input').value);
        const doc = S.nodeAlertDoc(st.u, st.view, c.x, c.k, c.v, dir, pct);
        if (!doc) { toast('Enter a percent from 1 to 1000.'); return; }
        await writeAlert('zoroAlerts', doc);
        toast('Alert set: ' + st.u + ' ' + S.fmtK(c.k) + ' ' + c.col.label.date + ' ' + S.VIEWS[st.view].short + ' ' + (dir === 'grow' ? 'grows' : 'shrinks') + ' by ' + pct + '%.');
      } else {
        const fut = body && body.fut && isNum(body.fut.ratio) ? body.fut : null;
        const chartSym = opts.chartSymbol ? opts.chartSymbol() : '';
        if (!fut) { toast('Price alerts follow the matching futures market, and there is none for ' + st.u + ' right now.'); return; }
        const conv = (v) => v * fut.ratio;
        const pa = S.priceAlertFor(a.dataset.a, c.k, body.spot, body.step, conv);
        if (!pa) { toast('Could not work out the price for this strike.'); return; }
        // the alert sits on the futures market the server watches: the chart's own future when it maps here, else the front month
        const sym = chartSym && S.tickerFor(chartSym) === st.u && /1!$/.test(chartSym) ? chartSym : 'futures:' + fut.root + '1!';
        const doc = { symbol: sym, cond: pa.cond, price: pa.price, message: ('Spectra ' + st.u + ' ' + S.fmtK(c.k) + (a.dataset.a === 'near' ? ' (near)' : '')).slice(0, 140), freq: 'once', active: true };
        if (opts.addPriceAlert) await opts.addPriceAlert(doc); else await writeAlert('chartAlerts', doc);
        toast('Alert set: ' + fut.root + ' ' + (a.dataset.a === 'near' ? 'nears' : 'touches') + ' ' + pa.price.toLocaleString('en-US', { maximumFractionDigits: 2 }) + ' (' + st.u + ' ' + S.fmtK(c.k) + ').');
      }
      closeMenu();
    } catch (err) {
      if (err && err.full) return;
      toast(err && err.signin ? 'Sign in to set alerts.' : 'Could not save the alert. Check your connection and try again.');
    }
  });
  menu.addEventListener('keydown', (e) => {
    const items = [...menu.querySelectorAll('[role=menuitem], [data-d], input')];
    const i = items.indexOf(document.activeElement);
    if (e.key === 'Escape') { e.preventDefault(); closeMenu(); }
    else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && document.activeElement.tagName !== 'INPUT') { e.preventDefault(); const n = items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]; if (n) n.focus(); }
  });
  document.addEventListener('pointerdown', (e) => { if (!menu.hidden && !menu.contains(e.target)) closeMenu(); }, true);
  window.addEventListener('blur', closeMenu);

  // ---- lifecycle ----
  const moTheme = new MutationObserver(() => { if (st.active) render(); });
  moTheme.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  ProGate.onTier(() => { if (ProGate.isFree() && st.u !== 'SPX') setTicker('SPX'); syncControls(); });
  function startTimers() {
    stopTimers();
    st.timer = setInterval(() => { if (document.hidden) return; load(true); if (st.tab === 'trio') { S.TRIO.forEach((u) => cache.delete(u + '|0')); loadTrio(); } }, POLL_MS);
    st.tick = setInterval(() => { if (st.body) upd.textContent = S.updatedText(st.body.t); }, 1000);
  }
  function stopTimers() { clearInterval(st.timer); clearInterval(st.tick); st.timer = st.tick = 0; }
  syncControls();
  return {
    open() { st.active = true; render(); load(false); if (st.tab === 'trio') loadTrio(); startTimers(); },
    close() { st.active = false; stopTimers(); closeMenu(); },
    setTicker: (u) => setTicker(u),
    get ticker() { return st.u; }, get view() { return st.view; }, get model() { return st.model; },
    refresh: () => load(true), relayout: () => {},
    _state: st
  };
}
