// TradeZoro — Charts: more room for the chart on a PHONE (ES module, charts.html only)
// Owner 2026-10-26 ("chart area is small, lower main menu, market open box, upper head headbar menu
// are taking space"). On a phone (<= 700 px wide) the Charts page gets ONE top bar:
//   1. the site header row is hidden; its menu button (opens the side menu) and the notifications
//      bell move into the chart toolbar (#stkc-bar), at its start / end;
//   2. the market clock (#mclock, assets/market-hours.js) leaves its own strip and sits in the
//      toolbar as a small coloured dot + short countdown ("● Asia 4m"); tap it for the full text;
//   3. the grey footnote strip under the chart is hidden; its text (kept live: it follows the
//      symbol, chart-data-dot.js) is shown in the ⓘ Symbol info panel and the Credits popover;
//   4. the bottom nav (Charts / GEX / Journal / Learn / More) hides; a small handle at the bottom
//      edge (tap, or swipe up from the bottom) brings it back over the chart; it hides again after
//      a few seconds without a touch on it, or on a tap anywhere on the chart;
//   5. the favourites drawing bar starts folded (assets/chart-fav-toolbar.js).
// Full screen (both phone and desktop) is assets/chart-tv-toolbars.js (html.stk-chart-fs).
// Everything moved goes back to its exact place when the window grows past the phone width.
// Desktop is untouched. A phone in landscape (data-device="mobile") counts as a phone.
// Depends on: charts.html (.mobile-topnav, #dash-menu-toggle, .notif-bell-wrap, #stkc-bar,
// .stkchart-credit, #appnav-dock), market-hours.js (#mclock, StrykerMarketHours), style.css
// (html.stk-cps block), vela-chart.js (re-measures header / dock on resize).

const PHONE_MAX = 700;
const HIDE_MS = 4000;
const html = document.documentElement;
const byId = (id) => document.getElementById(id);
// a phone held sideways (844 x 390) is wider than PHONE_MAX but has even less height: the
// phone-class device (device-mode.js data-device="mobile") gets the same one top bar (2026-10-26,
// phone multi-chart layouts: a 2 x 2 grid in landscape needs every pixel of height)
const isPhone = () => window.innerWidth <= PHONE_MAX || html.getAttribute('data-device') === 'mobile';

export function mountPhoneSpace() {
  if (window.__stkCps) return window.__stkCps;
  const bar = byId('stkc-bar');
  const barL = byId('stkc-bar-l');
  const barR = bar && bar.querySelector('.stkc-bar-r');
  if (!bar || !barL || !barR) return null;

  // ---- 1. menu button + bell into the toolbar ----
  const menuBtn = document.createElement('button');
  menuBtn.type = 'button';
  menuBtn.className = 'stkc-ib stkcps-menu';
  menuBtn.id = 'stkcps-menu';
  menuBtn.title = 'Menu';
  menuBtn.setAttribute('aria-label', 'Open menu');
  menuBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16"/><path d="M4 12h16"/><path d="M4 17h16"/></svg>';
  menuBtn.addEventListener('click', (e) => { e.stopPropagation(); const t = byId('dash-menu-toggle'); if (t) t.click(); });

  const moved = [];   // [{ node, ph }]
  function moveInto(node, parent, before) {
    if (!node || parent.contains(node)) return;
    const ph = document.createComment('stkcps home');
    node.parentNode.insertBefore(ph, node);
    parent.insertBefore(node, before || null);
    moved.push({ node, ph });
  }
  function restore() {
    while (moved.length) { const m = moved.pop(); if (m.ph.parentNode) m.ph.parentNode.replaceChild(m.node, m.ph); }
  }

  // ---- 2. market clock: compact "● Asia 4m" ----
  const MH = () => window.StrykerMarketHours;
  // "4m", "6h", "2d": one unit, so the toolbar keeps room for the symbol (the popover has the clock)
  function compact(ms) {
    const m = Math.max(0, Math.round(ms / 60000));
    if (m < 60) return m + 'm';
    const h = Math.floor(m / 60);
    if (h < 24) return h + 'h';
    return Math.floor(h / 24) + 'd';
  }
  const abbr = (n) => ({ 'London': 'LDN', 'New York': 'NY' })[n] || n;
  function tinyText() {
    const mh = MH();
    if (!mh || !mh.sessionLabel) return '';
    const rp = window.__stkReplay && window.__stkReplay.on;
    const now = rp ? window.__stkReplay.E : Date.now();
    const l = mh.sessionLabel(now);
    if (rp) return 'Replay';
    // the next thing that happens: the market close / open when it comes first, else the next session
    if (l.next && !(l.market.until < l.next.at)) return abbr(l.next.name || l.next.short) + ' ' + compact(l.next.at - now);
    return (l.marketOpen ? 'Close ' : 'Open ') + compact(l.market.until - now);
  }
  function paintTiny() {
    const w = byId('mclock');
    if (!w) return;
    let t = w.querySelector('.mclock-tiny');
    if (!t) {
      t = document.createElement('span');
      t.className = 'mclock-tiny';
      const pill = w.querySelector('.mclock-pill');
      if (pill) pill.appendChild(t);
    }
    const s = tinyText();
    if (t.textContent !== s) t.textContent = s;
    // still too tight (long symbol, many buttons): the dot alone, the text stays in the popover
    w.classList.remove('mclock-dotonly');
    const over = () => [bar, barL, barR].some((b) => b.scrollWidth > b.clientWidth + 1);
    if (over()) w.classList.add('mclock-dotonly');
  }
  setInterval(() => { if (on && !document.hidden) paintTiny(); }, 15000);

  // ---- 3. footnote into the ⓘ panels ----
  const credit = document.querySelector('.stkchart-credit');
  const copies = [];
  function addCopy(host, before, cls) {
    if (!host || host.querySelector('.' + cls)) return;
    const p = document.createElement('p');
    p.className = cls;
    host.insertBefore(p, before || null);
    copies.push(p);
    syncCopies();
  }
  function syncCopies() { const t = credit ? credit.textContent.trim() : ''; copies.forEach((p) => { if (p.textContent !== t) p.textContent = t; }); }
  if (credit) new MutationObserver(syncCopies).observe(credit, { childList: true, characterData: true, subtree: true });
  function placeCopies() {
    const stkin = byId('stkin');
    if (stkin) addCopy(stkin, stkin.querySelector('.stkin-foot'), 'stkin-src');
    const cred = byId('stkc-credits');
    if (cred) addCopy(cred, cred.firstChild && cred.firstChild.nextSibling, 'stkc-pop-src');
  }

  // ---- 4. bottom nav: auto-hide + handle ----
  const dock = byId('appnav-dock');
  const handle = document.createElement('button');
  handle.type = 'button';
  handle.className = 'stkcps-handle';
  handle.id = 'stkcps-handle';
  handle.setAttribute('aria-label', 'Show the main menu bar');
  handle.setAttribute('aria-expanded', 'false');
  handle.setAttribute('aria-controls', 'appnav-dock');
  handle.innerHTML = '<span aria-hidden="true"></span>';
  document.body.appendChild(handle);
  let hideT = 0;
  const navShown = () => html.classList.contains('stk-cps-nav');
  function setNav(show) {
    clearTimeout(hideT);
    html.classList.toggle('stk-cps-nav', !!show);
    handle.setAttribute('aria-expanded', show ? 'true' : 'false');
    if (show) hideT = setTimeout(() => { if (!(dock && dock.matches(':focus-within')) && !html.classList.contains('appnav-sheet-open')) setNav(false); else setNav(true); }, HIDE_MS);
  }
  handle.addEventListener('click', (e) => { e.stopPropagation(); setNav(!navShown()); });
  if (dock) {
    ['pointerdown', 'focusin'].forEach((ev) => dock.addEventListener(ev, () => { if (navShown()) setNav(true); }));
  }
  // swipe up from the bottom edge
  let sy = null;
  document.addEventListener('touchstart', (e) => {
    if (!on || e.touches.length !== 1) { sy = null; return; }
    const t = e.touches[0];
    sy = t.clientY > window.innerHeight - 28 ? t.clientY : null;
  }, { passive: true });
  document.addEventListener('touchmove', (e) => {
    if (sy == null || !e.touches.length) return;
    if (sy - e.touches[0].clientY > 30) { sy = null; setNav(true); }
  }, { passive: true });
  // a tap on the chart hides it again
  document.addEventListener('pointerdown', (e) => {
    if (!on || !navShown()) return;
    if (e.target.closest && (e.target.closest('#appnav-dock') || e.target.closest('#stkcps-handle') || e.target.closest('.appnav-sheet'))) return;
    setNav(false);
  }, true);

  // ---- on / off ----
  let on = false;
  function apply() {
    const want = isPhone();
    if (want === on) { if (on) { placeCopies(); placeClock(); paintTiny(); } return; }
    on = want;
    html.classList.toggle('stk-cps', on);
    if (on) {
      barL.insertBefore(menuBtn, barL.firstChild);
      const bell = document.querySelector('.mobile-topnav .notif-bell-wrap');
      if (bell) moveInto(bell, barR, null);
      placeClock();
      placeCopies();
    } else {
      setNav(false);
      if (menuBtn.parentNode) menuBtn.remove();
      restore();
    }
    window.dispatchEvent(new Event('resize'));   // vela-chart.js re-measures the header and the dock
  }
  function placeClock() {
    const w = byId('mclock');
    if (!w || bar.contains(w)) return;
    // right after the spacer chart-onebar.js puts at the start of the right half
    const sp = barR.querySelector('.stkc-ob-sp');
    moveInto(w, barR, sp ? sp.nextSibling : barR.firstChild);
    paintTiny();
  }
  apply();
  window.addEventListener('resize', apply, { passive: true });
  // the clock and the Symbol info panel mount later
  const mo = new MutationObserver(() => { if (on) { placeClock(); placeCopies(); } });
  mo.observe(document.body, { childList: true, subtree: true });
  setTimeout(() => mo.disconnect(), 30000);
  // the toolbar changes (symbol name, buttons folding into ⋯): re-check the clock's room
  try { new ResizeObserver(() => { if (on) requestAnimationFrame(paintTiny); }).observe(barL); } catch (e) {}

  const api = { setNav, get on(){ return on; }, get navShown(){ return navShown(); }, tinyText, compact };
  window.__stkCps = api;
  return api;
}
