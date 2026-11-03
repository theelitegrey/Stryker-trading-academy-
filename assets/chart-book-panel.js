// TradeZoro — Book · DOM · Trades panel beside the chart (crypto + futures). Owner order 2026-11-03.
// ONE panel, three tabs: Book (both sides + running total), DOM (price ladder: Bid | Price | Ask | Bought | Sold | Delta),
// Trades (Time & Sales). Crypto: Binance, Binance US, Coinbase, Hyperliquid straight from the browser (public streams),
// one exchange or Combined (sizes added up per price). Futures: the L2 hub in chart-futures-l2.js (same admin gate, l2Visible()).
// Paper trading from the DOM: bid cell = paper BUY, ask cell = paper SELL (limit; market at / through the touch), simulated only,
// through chart-paper.js (same switch, same rules as the chart's ticket). Right-click / long-press a row: draw a level or a zone.
// Logic lives in book-panel-core.js (unit-tested), streams in book-panel-sources.js. Phones <= 700 px: bottom sheet.
// Wording: "updated Xs ago" only; no real-time claims. Education only. Not financial advice.
import { l2Visible, l2Listed, l2Unlock, l2Root, acquire, rootState, L2_TICK } from './chart-futures-l2.js?v=844';
import { rtReady, rtOnChange } from './rt-access.js?v=844';
import * as C from './book-panel-core.js?v=844';
import { SOURCES, sourceName, openSource as realOpen } from './book-panel-sources.js?v=844';

const KEY = 'stkbp.v1', MULT = [1, 2, 5, 10, 50], LEVELS = [20, 60, 150], WINS = [['session', 'Session', 0], ['1h', '1h', 3600000], ['5m', '5m', 300000]];
const FILTERS_C = [['0', 'All sizes'], ['1000', '≥ $1k'], ['10000', '≥ $10k'], ['100000', '≥ $100k']], FILTERS_F = [['0', 'All sizes'], ['5', '≥ 5'], ['25', '≥ 25'], ['100', '≥ 100']];
const CRYPTO = ['binance', 'coinbase', 'hyperliquid', 'binanceus'];
const isLocal = () => /^(127\.0\.0\.1|localhost)$/.test(location.hostname);
const el = (tag, cls, html) => { const n = document.createElement(tag); if (cls) n.className = cls; if (html != null) n.innerHTML = html; return n; };
const svg = (d, s) => '<svg width="' + (s || 18) + '" height="' + (s || 18) + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + '</svg>';
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const ago = (ms) => (ms < 1500 ? '' : ms < 60000 ? Math.round(ms / 1000) + 's' : Math.round(ms / 60000) + ' min');
const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; } };

export function mountBookPanel(ws, opts) {
  opts = opts || {};
  if (!ws || document.getElementById('stkbp')) return null;
  const host = document.querySelector('.stkchart-panel.stkw-host') || document.querySelector('.stkchart-panel');
  if (!host) return null;
  const openSource = (isLocal() && window.__stkBookTest && window.__stkBookTest.openSource) || realOpen;   // localhost fixtures only
  const isPhone = () => window.innerWidth <= 700;
  const saved = load();
  const S = { tab: ['book', 'dom', 'trades'].includes(saved.tab) ? saved.tab : 'book', src: saved.src || 'combined', g: clamp(+saved.g || 0, 0, MULT.length - 1), win: saved.win || 'session', lv: LEVELS.includes(saved.lv) ? saved.lv : 60, filter: saved.filter || '0', w: clamp(+saved.w || 400, 320, 640) };
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} };
  let open = false, feed = null, raf = 0, tm = 0, lastPaint = 0, rh = 22, rowsN = 12, free = false, topKey = 0, paused = 0, zoneFrom = null, qty = 0, qtyKey = '', poolTab = '', drag = null, hint = false;

  // ------------------------------------------------------------------------------------------------ DOM
  const railBtn = el('button', 'stkw-railbtn stkl2-railbtn stkbp-railbtn', svg('<path d="M4 5h16M4 10h10M4 15h13M4 20h7"/>')); railBtn.type = 'button'; railBtn.title = 'Book · DOM · Trades'; railBtn.setAttribute('aria-label', 'Book, DOM and Trades'); railBtn.setAttribute('aria-pressed', 'false'); railBtn.hidden = true;
  const phoneBtn = el('button', 'stkc-btn stkl2-phonebtn stkbp-phonebtn', svg('<path d="M4 5h16M4 10h10M4 15h13M4 20h7"/>', 16) + '<span class="stkc-btn-l">DOM</span>'); phoneBtn.type = 'button'; phoneBtn.setAttribute('aria-label', 'Book, DOM and Trades'); phoneBtn.hidden = true;
  const panel = el('aside', 'stkbp'); panel.id = 'stkbp'; panel.hidden = true; panel.setAttribute('aria-label', 'Order book, DOM and trades');
  panel.innerHTML =
    '<i class="stkbp-grip" aria-hidden="true"></i><div class="stkbp-grab" aria-hidden="true"></div>' +
    '<div class="stkbp-hd"><label class="stkbp-srcw"><span class="stkbp-sym"></span><select class="stkbp-sel stkbp-src" aria-label="Data source"></select></label><span class="stkbp-sp"></span><button type="button" class="stkbp-x" aria-label="Close panel">' + svg('<path d="M6 6l12 12M18 6L6 18"/>') + '</button></div>' +
    '<div class="stkbp-tabs" role="tablist" aria-label="Panel view"><button type="button" role="tab" data-t="book">Book</button><button type="button" role="tab" data-t="dom">DOM</button><button type="button" role="tab" data-t="trades">Trades</button></div>' +
    '<div class="stkbp-ctl"><select class="stkbp-sel stkbp-grp" data-for="book dom" aria-label="Price grouping"></select>' +
    '<span class="stkbp-seg" data-for="dom" role="group" aria-label="Window"></span><span class="stkbp-seg stkbp-lvs" data-for="dom" role="group" aria-label="Levels"></span>' +
    '<button type="button" class="stkbp-btn stkbp-rec" data-for="dom" hidden>Recentre</button>' +
    '<select class="stkbp-sel stkbp-flt" data-for="trades" aria-label="Minimum size"></select><button type="button" class="stkbp-btn stkbp-pause" data-for="trades" aria-pressed="false">Pause</button></div>' +
    '<div class="stkbp-paper" hidden><span class="stkbp-pl">Paper</span><span class="stkbp-qty"><button type="button" data-q="-1" aria-label="Less">−</button><input type="text" inputmode="decimal" aria-label="Paper quantity"><button type="button" data-q="1" aria-label="More">+</button></span><span class="stkbp-pos"></span></div>' +
    '<div class="stkbp-stat"></div><div class="stkbp-cols"></div><div class="stkbp-list" role="table"></div><div class="stkbp-bar" hidden></div>' +
    '<p class="stkbp-foot"></p><div class="stkbp-menu" role="menu" hidden></div>';
  host.appendChild(panel);
  const $ = (s) => panel.querySelector(s);
  const list = $('.stkbp-list'), cols = $('.stkbp-cols'), stat = $('.stkbp-stat'), foot = $('.stkbp-foot'), bar = $('.stkbp-bar'), menu = $('.stkbp-menu'), paperBar = $('.stkbp-paper'), qtyIn = $('.stkbp-qty input');
  const barR = document.querySelector('#stkc-bar .stkc-bar-r'); if (barR) barR.insertBefore(phoneBtn, barR.firstChild);
  $('.stkbp-grp').innerHTML = MULT.map((m, i) => '<option value="' + i + '"></option>').join('');
  $('.stkbp-seg[aria-label=Window]').innerHTML = WINS.map((w) => '<button type="button" data-w="' + w[0] + '">' + w[1] + '</button>').join('');
  $('.stkbp-lvs').innerHTML = LEVELS.map((n) => '<button type="button" data-n="' + n + '" aria-label="' + n + ' levels per side">' + n + '</button>').join('');

  // ------------------------------------------------------------------------------------------------ what is on the chart
  const kindOf = () => {
    let sym = ''; try { sym = ws.active.symbol || ''; } catch (e) {}
    let m = /^([a-z0-9]+):(.+)$/i.exec(sym); const prov = m ? m[1].toLowerCase() : '', tk = m ? m[2] : sym;
    if (prov === 'futures') { const root = l2Root(tk); return { kind: 'fut', sym, root, tick: root ? L2_TICK[root] || 0.25 : 0 }; }
    if (CRYPTO.includes(prov)) return { kind: 'crypto', sym, pair: C.pairOf(tk), prov };
    return { kind: 'none', sym };
  };
  const feedKey = (k) => (k.kind === 'fut' ? 'f|' + k.root : k.kind === 'crypto' ? 'c|' + k.pair.base + k.pair.quote + k.pair.perp + '|' + S.src : '');
  function detach() {
    if (!feed) return;
    for (const s of feed.stops) { try { s(); } catch (e) {} }
    feed = null; free = false; zoneFrom = null;
  }
  function attach() {
    const k = kindOf(), key = feedKey(k);
    if (feed && feed.key === key) { feed.k = k; return; }
    detach();
    if (!key || (k.kind === 'fut' && !l2Visible())) { feed = k.kind === 'fut' ? { key: '', k, books: new Map(), stops: [], store: new C.TradeStore(), msg: 'The futures order book is part of Pro. Upgrade to unlock it.' } : null; if (feed) feed.k = k; schedule(); return; }
    const f = feed = { key, k, books: new Map(), stops: [], store: new C.TradeStore(), step: 0, msg: '', dirty: true };
    if (k.kind === 'fut') {
      f.store.notional = false;
      const h = acquire(k.root, (m) => { if (m && m.type === 'ticks') f.store.add((m.t || []).map((x) => ({ t: x[3], p: x[0], s: x[1], side: x[2] > 0 ? 1 : -1, ex: 'cme' }))); schedule(); }, 150);
      f.stops.push(() => h.release());
      const ring = (rootState(k.root).trades && rootState(k.root).trades.ring) || [];
      f.store.add(ring.map((x) => ({ t: x[0], p: x[1], s: x[2], side: x[3] > 0 ? 1 : -1, ex: 'cme' })));
      f.futRoot = k.root;
    } else {
      f.store.notional = true;
      const ids = S.src === 'combined' ? SOURCES.map((s) => s.id) : [S.src];
      for (const id of ids) {
        const e = { id, status: 'loading', note: '', book: null, at: 0 }; f.books.set(id, e);
        f.stops.push(openSource(id, k.pair, {
          book: (b) => { e.book = b; e.at = Date.now(); f.dirty = true; schedule(); },
          trades: (l, back) => { f.store.add(l); schedule(); },
          status: (st, note) => { e.status = st; e.note = note || ''; schedule(); }
        }));
      }
    }
    schedule();
  }

  // ------------------------------------------------------------------------------------------------ model
  let cacheKey = '', cached = null;
  function futBook(r) {
    const s = r && r.snap; if (!s || !s.bids || !s.bids.length || !s.asks || !s.asks.length) return null;
    return { bids: new Map(s.bids), asks: new Map(s.asks) };
  }
  function model() {
    const f = feed; if (!f || !f.key) return null;
    let books = [];
    if (f.k.kind === 'fut') { const b = futBook(rootState(f.futRoot)); if (b) books = [b]; }
    else f.books.forEach((e) => { if (e.book && (e.status === 'live' || e.status === 'reconnecting')) books.push(e.book); });
    if (!books.length) return null;
    if (!f.step) {
      if (f.k.kind === 'fut') f.step = f.k.tick;
      else { let bb = 0, ba = Infinity; books[0].bids.forEach((q, p) => { if (p > bb) bb = p; }); books[0].asks.forEach((q, p) => { if (p < ba) ba = p; }); if (bb > 0 && ba < Infinity) f.step = C.autoStep((bb + ba) / 2); }
      if (!f.step) return null;
    }
    const step = Math.round(f.step * MULT[S.g] * 1e8) / 1e8;
    const m = C.mergeBooks(books, step, 400);
    return m.bids.length && m.asks.length ? { m, step, books: books.length } : null;
  }

  // ------------------------------------------------------------------------------------------------ paper
  const P = () => window.__stkPaper || null;
  const paperOn = () => { const p = P(); return !!(p && p.enabled && p.account); };
  const acct = () => { const p = P(); return p && p.account; };
  const specOf = () => { try { return acct().spec(feed.k.sym); } catch (e) { return { ok: false }; } };
  function paperState() {
    if (!paperOn() || !feed || !feed.key) return null;
    const a = acct(), sp = specOf(); if (!sp.ok) return null;
    const orders = a.state.orders.filter((o) => o.symbol === sp.symbol), pos = a.position(feed.k.sym);
    return { a, sp, orders, pos };
  }
  const stepQty = (sp, q, dir) => { if (sp.kind === 'futures') return Math.max(sp.minQty, q + dir); const st = Math.pow(10, Math.floor(Math.log10(Math.max(q, sp.minQty)))); return Math.max(sp.minQty, Math.round((q + dir * st) * 1e8) / 1e8); };
  function syncQty(ps) {
    const key = feed.k.sym; if (qtyKey === key && qty > 0) return;
    qtyKey = key; try { qty = ps.a.qtyFor(feed.k.sym) || ps.sp.minQty; } catch (e) { qty = ps.sp.minQty; }
    qtyIn.value = String(qty);
  }
  function trade(cell, price, mdl) {
    const ps = paperState();
    if (!ps) { if (!hint && opts.toast) { hint = true; opts.toast('Turn on Paper trading in Chart settings to trade from the ladder (simulated, demo money).', 'info'); } return; }
    const q = parseFloat(qtyIn.value); if (!(q > 0)) return;
    const o = C.clickToOrder(cell, price, mdl.m.bids[0][0], mdl.m.asks[0][0]); if (!o) return;
    P().placeOrder(Object.assign({ symbol: feed.k.sym, qty: q }, o));
    schedule();
  }

  // ------------------------------------------------------------------------------------------------ rows
  const ROWS = {
    book: () => '<span class="p"></span><span class="s"></span><span class="t"><i></i><b></b></span><span class="m"></span>',
    dom: () => '<span class="c" data-c="bid"><i></i><b></b><u class="chip" hidden></u></span><span class="p"></span><span class="c" data-c="ask"><i></i><b></b><u class="chip" hidden></u></span><span class="bt"></span><span class="sl"></span><span class="dl"></span>',
    trades: () => '<span class="p"></span><span class="s"></span><span class="t"></span>'
  };
  const COLS = { book: ['Price', 'Size', 'Total'], dom: ['Bid', 'Price', 'Ask', 'Bought', 'Sold', 'Delta'], trades: ['Price', 'Size', 'Time'] };
  function pool(n) {
    if (poolTab !== S.tab) { list.replaceChildren(); poolTab = S.tab; list.dataset.t = S.tab; cols.innerHTML = COLS[S.tab].map((c, i) => '<span>' + c + '</span>').join(''); cols.dataset.t = S.tab; }
    while (list.children.length < n) { const r = el('div', 'stkbp-r', ROWS[S.tab]()); r.setAttribute('role', 'row'); list.appendChild(r); }
    while (list.children.length > n) list.lastChild.remove();
  }
  const unit = () => (feed && feed.k.kind === 'fut' ? 'contracts' : feed && feed.k.pair ? feed.k.pair.base : '');
  const setBar = (i, w) => { i.style.width = (w > 0 ? Math.max(2, w * 100) : 0) + '%'; };
  const txt = (n, v) => { if (n.textContent !== v) n.textContent = v; };

  function paintBook(M) {
    const A = Math.max(3, Math.floor((rowsN - 1) / 2)), bm = C.bookModel(M.m, A), step = M.step;
    pool(A * 2 + 1);
    const asks = bm.asks.slice(-A), kids = list.children;
    const fill = (r, x, cls) => { r.className = 'stkbp-r ' + cls; r.dataset.p = x ? x.p : ''; txt(r.children[0], x ? C.fmtPrice(x.p, step) : ''); txt(r.children[1], x ? C.fmtSize(x.q) : ''); txt(r.children[2].lastChild, x ? C.fmtSize(x.t) : ''); setBar(r.children[2].firstChild, x ? x.t / bm.maxT : 0); };
    for (let i = 0; i < A; i++) fill(kids[i], asks[i - (A - asks.length)], 'is-ask');
    const mid = kids[A]; mid.className = 'stkbp-r is-mid'; mid.dataset.p = ''; txt(mid.lastChild, 'Spread ' + C.fmtPrice(bm.spread, step) + ' · ' + bm.bps.toFixed(2) + ' bps');
    for (let i = 0; i < A; i++) fill(kids[A + 1 + i], bm.bids[i], 'is-bid');
    cols.children[1].textContent = 'Size (' + unit() + ')';
    return bm;
  }

  let tradeCache = { v: -1, k: '', map: null };
  function tradeMap(step) {
    const w = WINS.find((x) => x[0] === S.win) || WINS[0], f = feed, k = f.store.v + '|' + step + '|' + w[0] + '|' + (w[2] ? Math.floor(Date.now() / 1000) : 0);
    if (tradeCache.k !== k || tradeCache.f !== f) tradeCache = { k, f, map: f.store.atPrice(w[2], step) };
    return tradeCache.map;
  }
  function paintDom(M) {
    const lm = C.ladderModel(M.m, tradeMap(M.step), M.step, S.lv); if (!lm) return null;
    const N = lm.rows.length, R = Math.min(rowsN, N), hiKey = lm.rows[0].key;
    let start = free ? hiKey - topKey : Math.round(lm.touchIndex - R / 2);
    start = clamp(start, 0, Math.max(0, N - R)); if (free) topKey = hiKey - start;
    pool(R);
    const ps = paperState(), ord = new Map();
    if (ps) for (const o of ps.orders) { const key = Math.round(o.price / M.step); (ord.get(key) || ord.set(key, []).get(key)).push(o); }
    const posKey = ps && ps.pos ? Math.round(ps.pos.avg / M.step) : null, kids = list.children, step = M.step;
    for (let i = 0; i < R; i++) {
      const x = lm.rows[start + i], r = kids[i];
      r.className = 'stkbp-r' + (x.isBid ? ' is-bid' : '') + (x.isAsk ? ' is-ask' : '') + (x.key === posKey ? ' is-pos' : '') + (x.key % 5 === 0 ? ' is-pt' : '') + (zoneFrom != null && Math.round(zoneFrom / step) === x.key ? ' is-from' : '');
      r.dataset.k = x.key; r.dataset.p = x.price;
      const bc = r.children[0], pc = r.children[1], ac = r.children[2];
      setBar(bc.children[0], x.bid / lm.maxQ); txt(bc.children[1], C.fmtSize(x.bid));
      setBar(ac.children[0], x.ask / lm.maxQ); txt(ac.children[1], C.fmtSize(x.ask));
      txt(pc, C.fmtPrice(x.price, step));
      txt(r.children[3], C.fmtSize(x.buy)); txt(r.children[4], C.fmtSize(x.sell));
      const dl = r.children[5]; txt(dl, C.fmtDelta(x.delta)); dl.className = 'dl' + (x.delta > 0 ? ' up' : x.delta < 0 ? ' dn' : '');
      r.children[3].style.setProperty('--w', x.buy / lm.maxT); r.children[4].style.setProperty('--w', x.sell / lm.maxT);
      const os = ord.get(x.key) || [];
      for (const [cell, side] of [[bc, 'buy'], [ac, 'sell']]) {
        const chip = cell.lastChild, o = os.find((z) => z.side === side);
        if (o) { chip.hidden = false; chip.dataset.oid = o.id; chip.className = 'chip ' + side; chip.innerHTML = '<em>' + (side === 'buy' ? 'B' : 'S') + ' ' + o.qty + '</em><s data-x="1" aria-label="Cancel paper order">×</s>'; }
        else if (!chip.hidden) { chip.hidden = true; delete chip.dataset.oid; }
      }
    }
    // paper header line
    return lm;
  }
  function paintTrades() {
    const f = feed, big = C.bigThreshold(f.store.recent(300, 0, paused)), min = +S.filter || 0;
    const rows = f.store.recent(rowsN, min, paused), tick = f.step || (f.k.tick || 0.01), kids = (pool(rowsN), list.children);
    for (let i = 0; i < rowsN; i++) {
      const x = rows[i], r = kids[i];
      if (!x) { r.className = 'stkbp-r'; for (const c of r.children) txt(c, ''); continue; }
      r.className = 'stkbp-r ' + (x.side > 0 ? 'tp-up' : 'tp-dn') + (x.s >= big ? ' is-big' : ''); r.dataset.p = x.p;
      txt(r.children[0], C.fmtPrice(x.p, tick)); txt(r.children[1], C.fmtSize(x.s)); txt(r.children[2], C.fmtTime(x.t));
    }
    cols.children[1].textContent = 'Size (' + unit() + ')';
    const sp = f.store.split(60000), b = Math.round(sp.pct);
    bar.hidden = false; bar.className = 'stkbp-bar'; bar.innerHTML = '<span class="l">1m</span><span class="trk"><i style="width:' + sp.pct.toFixed(1) + '%"></i></span><span class="v"><b class="up">' + (sp.buy + sp.sell ? b + '%' : '–') + '</b> buy · <b class="dn">' + (sp.buy + sp.sell ? 100 - b + '%' : '–') + '</b> sell</span>';
  }

  // ------------------------------------------------------------------------------------------------ paint
  function paint() {
    raf = 0; lastPaint = performance.now();
    if (!open) return;
    attach();
    const k = feed ? feed.k : kindOf();
    $('.stkbp-sym').textContent = k.kind === 'fut' ? k.root || '' : k.kind === 'crypto' ? k.pair.base + (k.pair.perp ? ' perp' : '') : '';
    panel.dataset.tab = S.tab;
    for (const b of panel.querySelectorAll('.stkbp-tabs button')) { const on = b.dataset.t === S.tab; b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on)); }
    for (const n of panel.querySelectorAll('[data-for]')) n.classList.toggle('stkbp-off', !n.dataset.for.split(' ').includes(S.tab));
    const fut = k.kind === 'fut';
    const src = $('.stkbp-src');
    const wantOpts = fut ? 'f' : 'c' + S.src;
    if (src.dataset.o !== wantOpts) { src.dataset.o = wantOpts; src.innerHTML = fut ? '<option>Futures L2</option>' : '<option value="combined">Combined</option>' + SOURCES.map((s) => '<option value="' + s.id + '">' + s.name + '</option>').join(''); src.value = S.src; src.disabled = fut; }
    const flt = $('.stkbp-flt'), fl = fut ? FILTERS_F : FILTERS_C; if (flt.dataset.o !== (fut ? 'f' : 'c')) { flt.dataset.o = fut ? 'f' : 'c'; flt.innerHTML = fl.map((x) => '<option value="' + x[0] + '">' + x[1] + '</option>').join(''); S.filter = fl.some((x) => x[0] === S.filter) ? S.filter : '0'; }
    flt.value = S.filter;
    for (const b of panel.querySelectorAll('[data-w]')) b.classList.toggle('on', b.dataset.w === S.win);
    for (const b of panel.querySelectorAll('[data-n]')) b.classList.toggle('on', +b.dataset.n === S.lv);
    $('.stkbp-rec').hidden = !free; $('.stkbp-pause').setAttribute('aria-pressed', String(!!paused)); $('.stkbp-pause').textContent = paused ? 'Resume' : 'Pause';
    // rows that fit
    rh = isPhone() ? 28 : 22; rowsN = clamp(Math.floor((list.clientHeight || 360) / rh), 8, 90);
    const ps = paperState();
    paperBar.hidden = !(ps && S.tab === 'dom');
    if (ps) { syncQty(ps); const p = ps.pos; $('.stkbp-pos').innerHTML = p ? '<b class="' + (p.side === 'buy' ? 'up' : 'dn') + '">' + (p.side === 'buy' ? 'Long ' : 'Short ') + p.qty + '</b> @ ' + C.fmtPrice(p.avg, feed.step || 0.01) + ' <em>' + (() => { try { const v = ps.a.openPnl(p); return (v >= 0 ? '+$' : '−$') + Math.abs(v).toFixed(2); } catch (e) { return ''; } })() + '</em>' : 'Flat'; }
    // status
    let msg = '';
    if (!feed) msg = 'Open a crypto or futures chart (BTC, ETH, NQ, ES …) to see its order book.';
    else if (feed.msg) msg = feed.msg;
    else if (fut && !feed.key) msg = 'The futures order book is part of Pro. Upgrade to unlock it.';
    const M = msg ? null : model();
    stat.innerHTML = statusHtml(M);
    if (!M || (S.tab === 'trades' && feed && feed.key && false)) {
      if (S.tab === 'trades' && feed && feed.key && !msg) { paintTrades(); }
      else { poolTab = ''; list.replaceChildren(); list.dataset.t = ''; const e = el('div', 'stkbp-empty'); e.textContent = msg || (feed && feed.k.kind === 'crypto' && [...feed.books.values()].every((b) => b.status === 'unlisted' || b.status === 'error') ? unlistedMsg() : 'Waiting for the order book…'); list.appendChild(e); bar.hidden = S.tab !== 'trades' || !feed || !feed.key; if (!bar.hidden) paintTradesBar(); }
    } else if (S.tab === 'book') { bar.hidden = true; paintBook(M); }
    else if (S.tab === 'dom') { bar.hidden = true; paintDom(M); }
    else paintTrades();
    const gs = $('.stkbp-grp'); if (feed && feed.step) { [...gs.options].forEach((o, i) => { const t = C.fmtPrice(feed.step * MULT[i], feed.step).replace(/\.0+$/, ''); if (o.textContent !== t) o.textContent = 'Group ' + t; }); gs.value = String(S.g); }
    foot.textContent = S.tab === 'dom' ? (paperOn() ? 'Tap a Bid cell to paper-buy, an Ask cell to paper-sell. ' : '') + 'Paper trading is simulated. Education only. Not financial advice.' : 'Order book depth and prints for learning. Education only. Not financial advice.';
    cols.style.display = list.dataset.t ? '' : 'none';
  }
  function paintTradesBar() { const sp = feed.store.split(60000); bar.innerHTML = '<span class="l">1m</span><span class="trk"><i style="width:' + sp.pct.toFixed(1) + '%"></i></span><span class="v"><b class="up">–</b> buy · <b class="dn">–</b> sell</span>'; }
  const unlistedMsg = () => { const n = [...feed.books.values()].map((b) => b.note).filter(Boolean); return n.length ? n[0] + '. Try another source.' : 'No exchange answered for this pair.'; };
  function statusHtml(M) {
    if (!feed || !feed.key) return '';
    if (feed.k.kind === 'fut') { const r = rootState(feed.futRoot), age = r.lastFrame ? Date.now() - r.lastFrame : -1, live = r.status === 'live'; return '<i class="stkbp-dot ' + (live ? 'is-live' : 'is-wait') + '"></i><span>' + (live ? 'Live L2' : 'Reconnecting…') + '</span><em>' + (live && age > 5000 ? 'updated ' + ago(age) + ' ago' : '') + '</em>'; }
    let h = '', any = false;
    feed.books.forEach((e) => { const live = e.status === 'live'; any = any || live; const cls = live ? 'is-live' : e.status === 'unlisted' || e.status === 'error' ? 'is-off' : 'is-wait'; h += '<span class="stkbp-ex ' + cls + '" title="' + (e.note || e.status) + '"><i class="stkbp-dot ' + cls + '"></i>' + sourceName(e.id) + (e.status === 'unlisted' ? ' · none' : '') + '</span>'; });
    return h;
  }
  function schedule() {
    if (!open || raf || tm) return;
    tm = setTimeout(() => { tm = 0; if (open && !raf) raf = requestAnimationFrame(paint); }, Math.max(0, 100 - (performance.now() - lastPaint)));   // <= 10 renders a second
  }

  // ------------------------------------------------------------------------------------------------ open / close / buttons
  function setOpen(v) {
    open = !!v; panel.hidden = !open; host.classList.toggle('stkbp-open', open);
    panel.style.setProperty('--stkbp-w', S.w + 'px'); host.style.setProperty('--stkbp-w', S.w + 'px');
    document.documentElement.classList.toggle('stkbp-sheet', open && isPhone());
    railBtn.setAttribute('aria-pressed', String(open)); railBtn.classList.toggle('on', open); phoneBtn.classList.toggle('on', open);
    if (open) {
      try { const g = window.__stkGexLadder; if (g && g.isOpen) g.close(); } catch (e) {}
      try { const n = window.__stkNews; if (n && n.isOpen) n.close(); } catch (e) {}
      try { if (host.classList.contains('stkw-open')) { const b = document.querySelector('.stkw .stkw-close'); if (b) b.click(); } } catch (e) {}
      try { const o = window.__stkL2Ladder; if (o && o !== api && o.isOpen) o.close(); } catch (e) {}
      attach(); requestAnimationFrame(paint);
    } else { clearTimeout(tm); tm = 0; detach(); closeMenu(); }
    requestAnimationFrame(() => { try { window.dispatchEvent(new Event('resize')); } catch (e) {} });
  }
  function showBtns() {
    const k = kindOf(), ok = k.kind === 'crypto' || (k.kind === 'fut' && l2Listed());
    railBtn.hidden = phoneBtn.hidden = !ok;
    if (!ok && open && !isPhone() && k.kind === 'none') { /* stays open: shows the hint */ }
  }
  function placeRail() {
    const rail = document.querySelector('.stkw-rail'); if (!rail) return false;
    if (railBtn.parentNode !== rail) { const after = rail.querySelector('.stkgl-railbtn') || rail.querySelector('.stkw-railbtn'); rail.insertBefore(railBtn, after ? after.nextSibling : rail.firstChild); }
    return true;
  }
  if (!placeRail()) { const mo = new MutationObserver(() => { if (placeRail()) mo.disconnect(); }); mo.observe(host, { childList: true, subtree: true }); setTimeout(() => mo.disconnect(), 30000); }
  rtReady().then(showBtns); try { rtOnChange(() => { showBtns(); schedule(); }); } catch (e) {} window.addEventListener('stryker:l2tier', () => { showBtns(); schedule(); }); showBtns();
  railBtn.addEventListener('click', () => { if (kindOf().kind === 'fut' && !l2Visible()) { l2Unlock(); return; } setOpen(!open); });
  phoneBtn.addEventListener('click', (e) => { e.stopPropagation(); if (kindOf().kind === 'fut' && !l2Visible()) { l2Unlock(); return; } setOpen(!open); });
  $('.stkbp-x').addEventListener('click', () => setOpen(false));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && open) { if (zoneFrom != null || !menu.hidden) { zoneFrom = null; closeMenu(); schedule(); } else if (isPhone()) setOpen(false); } });
  window.addEventListener('resize', () => { document.documentElement.classList.toggle('stkbp-sheet', open && isPhone()); if (open) schedule(); }, { passive: true });
  try { ws.on('state:changed', () => { showBtns(); if (open) schedule(); }); } catch (e) {}
  const tick = setInterval(() => { if (open) schedule(); }, 1000); window.addEventListener('pagehide', () => clearInterval(tick));

  // ------------------------------------------------------------------------------------------------ controls
  panel.querySelector('.stkbp-tabs').addEventListener('click', (e) => { const b = e.target.closest('button[data-t]'); if (!b) return; S.tab = b.dataset.t; save(); closeMenu(); schedule(); });
  $('.stkbp-src').addEventListener('change', (e) => { S.src = e.target.value; save(); detach(); schedule(); });
  $('.stkbp-grp').addEventListener('change', (e) => { S.g = +e.target.value; free = false; save(); schedule(); });
  $('.stkbp-flt').addEventListener('change', (e) => { S.filter = e.target.value; save(); schedule(); });
  $('.stkbp-seg[aria-label=Window]').addEventListener('click', (e) => { const b = e.target.closest('[data-w]'); if (b) { S.win = b.dataset.w; save(); schedule(); } });
  $('.stkbp-lvs').addEventListener('click', (e) => { const b = e.target.closest('[data-n]'); if (b) { S.lv = +b.dataset.n; save(); schedule(); } });
  $('.stkbp-rec').addEventListener('click', () => { free = false; schedule(); });
  $('.stkbp-pause').addEventListener('click', () => { paused = paused ? 0 : Date.now(); schedule(); });
  paperBar.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-q]'); if (!b) return; const ps = paperState(); if (!ps) return;
    qty = stepQty(ps.sp, parseFloat(qtyIn.value) || ps.sp.minQty, +b.dataset.q); qtyIn.value = String(qty);
  });
  qtyIn.addEventListener('change', () => { const v = parseFloat(qtyIn.value); if (v > 0) qty = v; else qtyIn.value = String(qty); });

  // ------------------------------------------------------------------------------------------------ list interaction
  const rowOf = (t) => t.closest && t.closest('.stkbp-r');
  let down = null, lp = 0;
  const closeMenu = () => { menu.hidden = true; menu.innerHTML = ''; };
  list.addEventListener('wheel', (e) => { if (S.tab !== 'dom') return; e.preventDefault(); free = true; if (!topKey) { const r = list.firstChild; topKey = r ? +r.dataset.k : 0; } topKey -= Math.sign(e.deltaY) * Math.max(1, Math.round(Math.abs(e.deltaY) / rh)); schedule(); }, { passive: false });
  list.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.chip')) return;
    down = { x: e.clientX, y: e.clientY, row: rowOf(e.target), cell: e.target.closest('[data-c]'), t: e.pointerType, moved: false, carry: 0, id: e.pointerId };
    clearTimeout(lp); if (down.row && e.pointerType !== 'mouse') lp = setTimeout(() => { if (down && !down.moved) { down.long = true; openMenu(down.row, e.clientX, e.clientY); } }, 520);
  });
  list.addEventListener('pointermove', (e) => {
    if (!down) return; const dy = e.clientY - down.y;
    if (Math.abs(dy) > 8 || Math.abs(e.clientX - down.x) > 8) { down.moved = true; clearTimeout(lp); }
    if (down.t !== 'mouse' && S.tab === 'dom' && down.moved) {   // touch / pen: drag scrolls the ladder
      const rowsMoved = Math.trunc((e.clientY - down.y) / rh) - down.carry; if (rowsMoved) { down.carry += rowsMoved; if (!free) { const r = list.firstChild; topKey = r ? +r.dataset.k : 0; free = true; } topKey += rowsMoved; schedule(); }
    }
  });
  const endDown = (e) => {
    clearTimeout(lp); const d = down; down = null; if (!d || d.long || d.moved) return;
    const r = d.row; if (!r || !r.dataset.p) return;
    const price = +r.dataset.p;
    if (zoneFrom != null) { finishZone(price); return; }
    if (S.tab === 'dom' && d.cell) { const M = model(); if (M) trade(d.cell.dataset.c, price, M); }
  };
  list.addEventListener('pointerup', endDown);
  list.addEventListener('pointercancel', () => { clearTimeout(lp); down = null; });
  list.addEventListener('contextmenu', (e) => { e.preventDefault(); const r = rowOf(e.target); if (r && r.dataset.p) { down = null; openMenu(r, e.clientX, e.clientY); } });
  // × cancels a working paper order; dragging its chip to another row moves it
  list.addEventListener('click', (e) => {
    const x = e.target.closest('s[data-x]'); if (!x) return; e.stopPropagation();
    const chip = x.closest('.chip'), id = +chip.dataset.oid; if (P()) P().cancelOrder(id); schedule();
  });
  list.addEventListener('pointerdown', (e) => {
    const chip = e.target.closest('.chip'); if (!chip || e.target.closest('s[data-x]') || chip.hidden) return;
    e.preventDefault(); drag = { oid: +chip.dataset.oid, to: null }; chip.setPointerCapture && chip.setPointerCapture(e.pointerId); chip.classList.add('drag');
    const mv = (ev) => { const t = document.elementFromPoint(ev.clientX, ev.clientY), r = t && rowOf(t); list.querySelectorAll('.is-drop').forEach((n) => n.classList.remove('is-drop')); if (r && r.dataset.k) { r.classList.add('is-drop'); drag.to = +r.dataset.p; } };
    const up = () => {
      chip.removeEventListener('pointermove', mv); chip.removeEventListener('pointerup', up); chip.classList.remove('drag'); list.querySelectorAll('.is-drop').forEach((n) => n.classList.remove('is-drop'));
      const d = drag; drag = null; if (d && d.to != null && P()) P().commitDrag(feed.k.sym, { id: 'o' + d.oid, price: d.to, kind: 'order' }); schedule();
    };
    chip.addEventListener('pointermove', mv); chip.addEventListener('pointerup', up);
  });

  // ------------------------------------------------------------------------------------------------ draw a level / a zone
  function openMenu(row, x, y) {
    const price = +row.dataset.p; if (!(price > 0)) return; const step = feed && feed.step || 0.01;
    menu.innerHTML = '<button type="button" role="menuitem" data-a="level">Draw level at ' + C.fmtPrice(price, step) + '</button><button type="button" role="menuitem" data-a="zone">Draw zone from here</button>';
    menu.hidden = false; menu.dataset.p = price;
    const pr = panel.getBoundingClientRect(), w = menu.offsetWidth || 200, h = menu.offsetHeight || 96;
    menu.style.left = clamp(x - pr.left, 8, Math.max(8, pr.width - w - 8)) + 'px'; menu.style.top = clamp(y - pr.top - h - 8, 8, Math.max(8, pr.height - h - 8)) + 'px';
  }
  menu.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-a]'); if (!b) return; const price = +menu.dataset.p; closeMenu();
    if (b.dataset.a === 'level') drawLevel(price); else { zoneFrom = price; if (opts.toast) opts.toast('Tap a second price to finish the zone (Esc cancels).', 'info'); schedule(); }
  });
  document.addEventListener('pointerdown', (e) => { if (!menu.hidden && !menu.contains(e.target)) closeMenu(); }, true);
  function chartTimes() {
    const o = ws.chart && ws.chart.orchestrator, rb = o && o.rawBars; if (!rb || !rb.length) return null;
    const last = rb[rb.length - 1].time, back = rb[Math.max(0, rb.length - 40)].time;
    return { last, back };
  }
  function drawLevel(price) {
    const t = chartTimes(); if (!t) { opts.toast && opts.toast('Open a chart with bars first.', 'info'); return; }
    const d = C.levelDrawing(price, t.last);
    try { ws.chart.drawings.add(d.type, d.opts); opts.toast && opts.toast('Level drawn at ' + C.fmtPrice(price, feed.step || 0.01), 'success'); } catch (e) { opts.toast && opts.toast('Could not draw on this chart.', 'error'); }
  }
  function finishZone(price) {
    const a = zoneFrom; zoneFrom = null; const t = chartTimes();
    if (!t || a == null) { schedule(); return; }
    if (Math.abs(price - a) < 1e-12) { schedule(); return; }
    const d = C.zoneDrawing(a, price, t.back, t.last);
    try { ws.chart.drawings.add(d.type, d.opts); opts.toast && opts.toast('Zone drawn', 'success'); } catch (e) { opts.toast && opts.toast('Could not draw on this chart.', 'error'); }
    schedule();
  }

  // ------------------------------------------------------------------------------------------------ resize (>= 821 px)
  $('.stkbp-grip').addEventListener('pointerdown', (e) => {
    if (window.innerWidth < 821) return; e.preventDefault(); const g = e.currentTarget, x0 = e.clientX, w0 = S.w; g.setPointerCapture(e.pointerId); panel.classList.add('sizing');
    const mv = (ev) => { S.w = clamp(Math.round(w0 + (x0 - ev.clientX)), 320, Math.min(640, Math.floor(window.innerWidth * 0.6))); panel.style.setProperty('--stkbp-w', S.w + 'px'); host.style.setProperty('--stkbp-w', S.w + 'px'); };
    const up = () => { g.removeEventListener('pointermove', mv); g.removeEventListener('pointerup', up); panel.classList.remove('sizing'); save(); try { window.dispatchEvent(new Event('resize')); } catch (e) {} schedule(); };
    g.addEventListener('pointermove', mv); g.addEventListener('pointerup', up);
  });

  const api = { open: () => setOpen(true), close: () => setOpen(false), get isOpen() { return open; }, setLevels: (n) => { S.lv = n; schedule(); }, setTab: (t) => { S.tab = t; save(); schedule(); }, _paint: paint, _state: () => ({ S, free, feed: !!feed }), setLevelsCompat: () => {} };
  window.__stkBookPanel = api; if (!window.__stkL2Ladder) window.__stkL2Ladder = api;
  return api;
}
