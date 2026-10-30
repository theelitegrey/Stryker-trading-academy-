// TradeZoro — ZoroCharts "futures data is delayed" pill + sheet (ES module)
// Depends on: assets/rt-access.js (rtReady, isRealtimeAdmin, rtOnChange), the Vela workspace (ws.active,
// ws.context().cells, cell.chart.renderer.renderer: .input.el + .coords.width for the plot/price-axis split),
// assets/rithmic-ui.js (window.STRYKER_RITHMIC.open, set once Connect broker has loaded), assets/auth.js (auth),
// assets/progress.js (db, for the plans/LiveData check), assets/toast.js (showToast).
// Owner order 2026-10-30: CME futures are 10 minutes behind by CME rule unless the member (a) connects Rithmic,
// (b) has the $5/month Live Futures Data add-on, or (c) is approved by the Owner (all make the server / the
// Rithmic provider real-time; this module only reflects that).
// Owner 2026-10-30 (second pass): the full-width strip under the toolbar was "too provoking". Now ONE small
// translucent pill floats at the bottom-centre of the active chart pane's plot (clear of the price axis, the time
// axis and any bottom bar), over the chart, never pushing the layout. Tap it (or the amber data dot) for a native
// bottom sheet (phone) / small popover above the pill (desktop) with two option rows: connect a prop firm
// (Rithmic) or the live data add-on. Long-press the pill, or "Hide for today" in the sheet, hides it until the
// next IST day (localStorage). Multi-chart layouts get one pill for the whole layout, shown if any pane is delayed.
import { rtReady, isRealtimeAdmin, rtOnChange } from './rt-access.js?v=745';

const LS_HIDE = 'stryker_data_pill_hidden_ist';   // value: IST date (YYYY-MM-DD) the member hid it on
const SS_OPEN = 'stryker_open_connect';
const FUT = /^(futures|cme|cme_mini|cbot|cbot_mini|comex|comex_mini|nymex|nymex_mini):/i;
const BARE = /^[A-Z0-9]+1!$/i;
const HELP = 'help.html#free-data-delay';
const CHECKOUT = 'checkout.html?plan=LiveData';
const ICON_LINK = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.5 1.5"/><path d="M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.5-1.5"/></svg>';
const ICON_BOLT = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13 2 4 14h7l-1 8 9-12h-7z"/></svg>';
const CHEV = '<svg class="stkdp-chev" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>';

const css = `
.stkdp, .stkdp-sheet{ --dp-font:-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, "Google Sans", system-ui, sans-serif;
  --dp-bg:var(--bg-1, #0b0b0d); --dp-row:var(--bg-2, #131316); --dp-line:var(--line, #2c2c32); --dp-ink:var(--ink-0, #eee);
  --dp-ink-2:var(--ink-2, #8b93a0); --dp-mint:var(--gold, #03c988); --dp-amber:var(--amber, #f5a623); }
/* The pill: a 44 px hit area holding a 32 px capsule. Positioned by JS (left/top) inside .stkchart-panel. */
.stkdp{ position:absolute; z-index:30; display:flex; align-items:center; height:44px; padding:0; margin:0; border:0; background:transparent;
  font-family:var(--dp-font); cursor:pointer; -webkit-tap-highlight-color:transparent; user-select:none; -webkit-user-select:none;
  -webkit-touch-callout:none; transform:translateX(-50%); transition:opacity .2s ease; }
.stkdp[hidden]{ display:none; }
.stkdp-cap{ display:inline-flex; align-items:center; gap:8px; height:32px; padding:0 10px 0 12px; border-radius:16px; box-sizing:border-box;
  background:rgba(22,23,27,.72); border:1px solid rgba(255,255,255,.08); color:rgba(235,235,245,.86);
  -webkit-backdrop-filter:saturate(180%) blur(16px); backdrop-filter:saturate(180%) blur(16px);
  box-shadow:0 2px 10px rgba(0,0,0,.28); font:500 13px/1 var(--dp-font); letter-spacing:-.08px; white-space:nowrap; transition:background .15s, transform .15s; }
.stkdp:hover .stkdp-cap{ background:rgba(34,35,40,.82); }
.stkdp:active .stkdp-cap{ transform:scale(.97); }
.stkdp:focus-visible{ outline:none; }
.stkdp:focus-visible .stkdp-cap{ box-shadow:0 0 0 2px var(--dp-mint); }
.stkdp-dot{ width:8px; height:8px; border-radius:50%; background:var(--dp-amber); flex:none; }
.stkdp-chev{ flex:none; opacity:.55; margin-left:-2px; }
.stkdp .stkdp-long{ display:none; }
@media (min-width:768px){ .stkdp .stkdp-long{ display:inline; } .stkdp .stkdp-short{ display:none; } }
:root[data-theme="light"] .stkdp-cap{ background:rgba(255,255,255,.78); border-color:rgba(0,0,0,.08); color:rgba(28,28,30,.86); box-shadow:0 2px 10px rgba(0,0,0,.10); }
:root[data-theme="light"] .stkdp:hover .stkdp-cap{ background:rgba(255,255,255,.92); }

/* The sheet (phone: bottom sheet; desktop: popover above the pill). Same values as the Connect sheet tokens. */
.stkdp-scrim{ position:fixed; inset:0; z-index:99970; background:rgba(0,0,0,.42); opacity:0; transition:opacity .2s ease; }
.stkdp-scrim.on{ opacity:1; }
.stkdp-scrim.pop{ background:transparent; }
.stkdp-scrim[hidden], .stkdp-sheet[hidden]{ display:none; }
.stkdp-sheet{ position:fixed; z-index:99975; box-sizing:border-box; background:var(--dp-bg); color:var(--dp-ink); font-family:var(--dp-font);
  -webkit-font-smoothing:antialiased; border:1px solid var(--dp-line); }
.stkdp-sheet.phone{ left:0; right:0; bottom:0; border-radius:16px 16px 0 0; border-width:1px 0 0; padding:8px 16px calc(16px + env(safe-area-inset-bottom, 0px));
  transform:translateY(100%); transition:transform .28s cubic-bezier(.2,.8,.2,1); max-height:85vh; overflow-y:auto; overscroll-behavior:contain;
  scrollbar-width:thin; scrollbar-color:rgba(150,160,175,.35) transparent; }
.stkdp-sheet.phone::-webkit-scrollbar{ width:6px; }
.stkdp-sheet.phone::-webkit-scrollbar-thumb{ background:rgba(150,160,175,.35); border-radius:3px; }
.stkdp-sheet.phone.on{ transform:none; }
.stkdp-sheet.pop{ width:360px; max-width:calc(100vw - 16px); border-radius:14px; padding:4px 16px 12px; box-shadow:0 12px 40px rgba(0,0,0,.45);
  opacity:0; transform:translateY(6px); transition:opacity .16s ease, transform .16s ease; }
.stkdp-sheet.pop.on{ opacity:1; transform:none; }
.stkdp-grab{ display:block; width:36px; height:5px; border-radius:3px; background:var(--dp-line); margin:0 auto 4px; }
.stkdp-sheet.pop .stkdp-grab{ display:none; }
.stkdp-head{ display:flex; align-items:center; gap:8px; min-height:52px; }
.stkdp-head h3{ flex:1; margin:0; font:600 20px/26px var(--dp-font); letter-spacing:-.2px; color:var(--dp-ink); }
.stkdp-sheet.pop .stkdp-head h3{ font-size:17px; line-height:22px; }
.stkdp-x{ flex:none; display:grid; place-items:center; width:30px; height:30px; padding:0; border:0; border-radius:50%; background:var(--dp-row); color:var(--dp-ink-2);
  font:500 18px/1 var(--dp-font); cursor:pointer; position:relative; }
.stkdp-x::after{ content:""; position:absolute; inset:-7px; }
.stkdp-x:hover{ color:var(--dp-ink); }
.stkdp-lead{ margin:0 0 16px; font:400 15px/20px var(--dp-font); color:var(--dp-ink-2); }
.stkdp-sheet.pop .stkdp-lead{ font-size:13px; line-height:18px; margin-bottom:12px; }
.stkdp-list{ list-style:none; margin:0; padding:0; border-radius:12px; overflow:hidden; background:var(--dp-row); }
.stkdp-row{ display:flex; align-items:center; gap:12px; width:100%; min-height:64px; padding:10px 12px 10px 14px; box-sizing:border-box; border:0; background:transparent;
  color:var(--dp-ink); text-align:left; text-decoration:none; font-family:var(--dp-font); cursor:pointer; -webkit-tap-highlight-color:transparent; }
.stkdp-list li + li .stkdp-row{ border-top:1px solid var(--dp-line); }
.stkdp-row:hover, .stkdp-row:focus-visible{ background:rgba(255,255,255,.04); outline:none; }
.stkdp-row:active{ background:rgba(255,255,255,.07); }
.stkdp-ic{ flex:none; display:grid; place-items:center; width:36px; height:36px; border-radius:10px; background:rgba(3,201,136,.14); color:var(--dp-mint); }
.stkdp-ic.b{ background:rgba(245,166,35,.14); color:var(--dp-amber); }
.stkdp-tx{ flex:1; min-width:0; display:flex; flex-direction:column; gap:2px; }
.stkdp-tx b{ font:600 16px/21px var(--dp-font); color:var(--dp-ink); }
.stkdp-tx span{ font:400 13px/18px var(--dp-font); color:var(--dp-ink-2); }
.stkdp-row .stkdp-chev{ color:var(--dp-ink-2); }
.stkdp-foot{ display:flex; align-items:center; justify-content:space-between; gap:8px; margin-top:8px; }
.stkdp-foot a, .stkdp-foot button{ display:inline-flex; align-items:center; min-height:44px; padding:0 4px; border:0; background:transparent;
  font:500 14px/20px var(--dp-font); color:var(--dp-ink-2); text-decoration:none; cursor:pointer; }
.stkdp-foot a{ color:var(--dp-mint); }
.stkdp-foot a:hover, .stkdp-foot button:hover{ text-decoration:underline; }
.stkdp-sheet.pop .stkdp-foot a, .stkdp-sheet.pop .stkdp-foot button{ min-height:36px; font-size:13px; }
@media (prefers-reduced-motion:reduce){ .stkdp-sheet, .stkdp-scrim, .stkdp, .stkdp-cap{ transition:none !important; } }
`;

// IST calendar day (YYYY-MM-DD): "Hide for today" lasts until the next IST day, never longer.
export function istDay(ms) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms == null ? Date.now() : ms));
}
export function isCmeSymbol(sym) {
  sym = String(sym || '');
  if (/^fx:/i.test(sym)) return false;
  return FUT.test(sym) || BARE.test(sym);
}

export function installDataBanner(ws, opts = {}) {
  if (document.getElementById('stkdp')) return window.STRYKER_DATA_BANNER;
  const panel = document.querySelector('.stkchart-panel');
  if (!panel) return null;
  const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
  if (getComputedStyle(panel).position === 'static') panel.style.position = 'relative';

  const pill = document.createElement('button');
  pill.type = 'button'; pill.className = 'stkdp'; pill.id = 'stkdp'; pill.hidden = true;
  pill.setAttribute('aria-haspopup', 'dialog');
  pill.setAttribute('aria-label', 'Futures data is 10 minutes delayed. Get live data');
  pill.innerHTML = '<span class="stkdp-cap"><i class="stkdp-dot" aria-hidden="true"></i><span class="stkdp-short">Delayed 10 min</span><span class="stkdp-long">Futures delayed 10 min</span>' + CHEV + '</span>';
  panel.appendChild(pill);

  const scrim = document.createElement('div'); scrim.className = 'stkdp-scrim'; scrim.hidden = true;
  const sheet = document.createElement('div');
  sheet.className = 'stkdp-sheet'; sheet.id = 'stkdp-sheet'; sheet.hidden = true;
  sheet.setAttribute('role', 'dialog'); sheet.setAttribute('aria-modal', 'true'); sheet.setAttribute('aria-labelledby', 'stkdp-title');
  sheet.innerHTML = '<i class="stkdp-grab" aria-hidden="true"></i>' +
    '<div class="stkdp-head"><h3 id="stkdp-title">Get live futures data</h3><button type="button" class="stkdp-x" id="stkdp-x" aria-label="Close">\u00d7</button></div>' +
    '<p class="stkdp-lead">CME futures are 10 minutes delayed on free data.</p>' +
    '<ul class="stkdp-list">' +
    '<li><button type="button" class="stkdp-row" id="stkdp-connect"><span class="stkdp-ic">' + ICON_LINK + '</span><span class="stkdp-tx"><b>Connect your prop firm</b><span>Use your own Rithmic login. Free.</span></span>' + CHEV + '</button></li>' +
    '<li><a class="stkdp-row" id="stkdp-buy" href="' + CHECKOUT + '"><span class="stkdp-ic b">' + ICON_BOLT + '</span><span class="stkdp-tx"><b>Live data add-on</b><span>$5 a month. Cancel anytime.</span></span>' + CHEV + '</a></li>' +
    '</ul>' +
    '<div class="stkdp-foot"><a href="' + HELP + '" id="stkdp-why">Why is it delayed?</a><button type="button" id="stkdp-hide">Hide for today</button></div>';
  document.body.append(scrim, sheet);

  const signedIn = () => { try { return !!(typeof auth !== 'undefined' && auth && auth.currentUser); } catch (e) { return false; } };
  const rithLive = () => {
    try { const r = (opts.getRith && opts.getRith()) || (opts.rith && opts.rith.client ? opts.rith : null); return !!(r && r.client && r.client.state === 'connected'); }
    catch (e) { return false; }
  };
  const hiddenToday = () => { try { return localStorage.getItem(LS_HIDE) === istDay(); } catch (e) { return false; } };
  const cells = () => { try { return ws.context().cells || []; } catch (e) { return []; } };
  const inReplay = () => !!(window.__stkReplay && window.__stkReplay.on);
  const isPhone = () => window.innerWidth < 768 || document.documentElement.getAttribute('data-device') === 'mobile';
  let ready = false;

  function anyDelayed() {
    const cs = cells();
    if (cs.length) return cs.some((c) => isCmeSymbol(c.symbol));
    try { return isCmeSymbol(ws.active ? ws.active.symbol : ''); } catch (e) { return false; }
  }
  // Viewer would see delayed CME data (independent of the "hide for today" choice): the data dot uses this too.
  const delayedViewer = () => ready && !rithLive() && !isRealtimeAdmin();

  // Bottom-centre of the active pane's PLOT (price axis excluded), above the time axis and any bar that sits
  // over the bottom of the pane (replay bar, paper-trading bar, bottom toolbars).
  function place() {
    const pr = panel.getBoundingClientRect();
    let cellEl = null, cv = null, plotW = 0;
    try {
      const a = ws.active;
      cellEl = document.querySelector('#vela-chart .vela-cell[data-cell-id="' + a.id + '"]');
      const R = a.chart.renderer.renderer;
      cv = R && R.input && R.input.el;
      plotW = R && R.coords ? R.coords.width : 0;
    } catch (e) {}
    if (!cellEl) cellEl = document.querySelector('#vela-chart .vela-cell[data-active="1"]') || document.querySelector('#vela-chart .vela-cell');
    const box = (cv || cellEl || panel).getBoundingClientRect();
    if (!plotW || plotW > box.width) plotW = Math.max(0, box.width - 64);
    const timeAxis = 28;                 // Vela's time-axis strip under the plot
    let bottom = Math.min(box.bottom, pr.bottom) - timeAxis - 8;
    const cx = box.left + plotW / 2, half = (pill.offsetWidth || 180) / 2;
    const left = cx - half, right = cx + half;   // only bars under the pill itself move it up
    // Anything floating over the lower part of the plot pushes the pill up above it.
    // .stkc-fl = the Fit price / Latest row (chart-settings.js), bottom right of every pane.
    const blockers = panel.querySelectorAll('.stkc-fl, .stkbr-bar, .stkbr, [class*="replay-bar"], [class*="paper-bar"], .stkpt-bar, .stkpaper, .vela-ws-bottom, .vela-bottom-toolbar');
    blockers.forEach((b) => {
      if (b === pill || b.contains(pill) || b.offsetParent === null) return;
      const r = b.getBoundingClientRect();
      if (!r.width || !r.height || r.right < left || r.left > right) return;
      if (r.bottom > bottom - 44 && r.top < bottom + 4 && r.top > box.top + box.height * 0.4) bottom = Math.min(bottom, r.top - 4);
    });
    const x = cx - pr.left;
    const y = bottom - 44 - pr.top;
    pill.style.left = Math.round(x) + 'px';
    pill.style.top = Math.round(Math.max(4, y)) + 'px';
  }

  function sync() {
    const show = delayedViewer() && !hiddenToday() && anyDelayed() && !inReplay();
    if (pill.hidden === show) pill.hidden = !show;
    if (show) place();
    if (!sheet.hidden && !(delayedViewer() && anyDelayed())) closeSheet();
  }

  let lastFocus = null;
  function openSheet() {
    lastFocus = document.activeElement;
    const phone = isPhone();
    document.querySelectorAll('.stkc-pop').forEach((p) => { if (!p.hidden) p.hidden = true; });
    sheet.classList.toggle('phone', phone); sheet.classList.toggle('pop', !phone);
    scrim.classList.toggle('pop', !phone);
    sheet.style.left = sheet.style.top = '';
    scrim.hidden = false; sheet.hidden = false;
    if (!phone) {
      const anchor = !pill.hidden ? pill.getBoundingClientRect() : null;
      const w = sheet.offsetWidth, h = sheet.offsetHeight;
      let lx, ty;
      if (anchor && anchor.width) { lx = anchor.left + anchor.width / 2 - w / 2; ty = anchor.top - h - 4; }
      else { lx = window.innerWidth / 2 - w / 2; ty = Math.max(64, window.innerHeight / 2 - h / 2); }
      sheet.style.left = Math.round(Math.max(8, Math.min(lx, window.innerWidth - w - 8))) + 'px';
      sheet.style.top = Math.round(Math.max(8, ty)) + 'px';
    }
    requestAnimationFrame(() => { scrim.classList.add('on'); sheet.classList.add('on'); });
    pill.setAttribute('aria-expanded', 'true');
    try { document.getElementById('stkdp-connect').focus({ preventScroll: true }); } catch (e) {}
  }
  function closeSheet() {
    if (sheet.hidden) return;
    scrim.classList.remove('on'); sheet.classList.remove('on');
    scrim.hidden = true; sheet.hidden = true;
    pill.setAttribute('aria-expanded', 'false');
    try { if (lastFocus && lastFocus.focus && lastFocus.isConnected && lastFocus !== document.body) lastFocus.focus({ preventScroll: true }); } catch (e) {}
  }
  function hideToday() {
    try { localStorage.setItem(LS_HIDE, istDay()); } catch (e) {}
    closeSheet(); sync();
    try { if (window.showToast) window.showToast('info', 'Hidden until tomorrow. Tap the amber dot by the symbol to see the options.'); } catch (e) {}
  }

  // Tap opens the sheet; a long-press (500 ms) hides the pill for today instead.
  let lpTimer = 0, longFired = false;
  const lpStart = () => { longFired = false; clearTimeout(lpTimer); lpTimer = setTimeout(() => { longFired = true; try { navigator.vibrate && navigator.vibrate(10); } catch (e) {} hideToday(); }, 500); };
  const lpEnd = () => clearTimeout(lpTimer);
  pill.addEventListener('pointerdown', (e) => { e.stopPropagation(); lpStart(); });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach((ev) => pill.addEventListener(ev, lpEnd));
  ['mousedown', 'touchstart'].forEach((ev) => pill.addEventListener(ev, (e) => e.stopPropagation(), { passive: true }));
  pill.addEventListener('contextmenu', (e) => e.preventDefault());
  pill.addEventListener('click', (e) => { e.stopPropagation(); if (longFired) { longFired = false; return; } openSheet(); });

  scrim.addEventListener('click', closeSheet);
  sheet.addEventListener('click', (e) => e.stopPropagation());
  document.getElementById('stkdp-x').addEventListener('click', closeSheet);
  document.getElementById('stkdp-hide').addEventListener('click', hideToday);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !sheet.hidden) closeSheet(); });
  window.addEventListener('resize', () => { if (!pill.hidden) place(); }, { passive: true });

  function openRithmic() {
    const R = window.STRYKER_RITHMIC;
    if (R && typeof R.open === 'function') { R.open(); return true; }
    return false;
  }
  document.getElementById('stkdp-connect').addEventListener('click', () => {
    closeSheet();
    if (!signedIn()) {   // sign in first, then the Connect sheet opens when ZoroCharts reloads
      try { sessionStorage.setItem(SS_OPEN, '1'); sessionStorage.setItem('stryker_return_to', location.pathname + location.search); } catch (e) {}
      location.href = 'login.html';
      return;
    }
    // Next tick: the Connect sheet closes itself on any document click, including this one.
    setTimeout(() => {
      if (!openRithmic()) {   // Connect broker module loads a moment after the first candles
        let n = 0; const t = setInterval(() => { if (openRithmic() || ++n > 40) clearInterval(t); }, 250);
      }
    }, 0);
  });
  // The add-on is sold only once plans/LiveData exists (the CoS writes it after a test-mode purchase works).
  // Until then the row says so instead of leading to a dead checkout.
  document.getElementById('stkdp-buy').addEventListener('click', (e) => {
    e.preventDefault();
    closeSheet();
    const go = () => { location.href = CHECKOUT; };
    const soon = () => { try { if (window.showToast) window.showToast('info', 'Live futures data ($5/month) opens today. For now, connect your Rithmic login or ask us for approval.'); } catch (x) {} };
    if (!signedIn()) { try { sessionStorage.setItem('stryker_return_to', '/' + CHECKOUT); } catch (x) {} go(); return; }
    try { db.collection('plans').doc('LiveData').get().then((d) => (d.exists && d.data().archived !== true ? go() : soon())).catch(soon); } catch (x) { soon(); }
  });

  // Came back from the sign-in this sheet sent them to: open the Connect sheet.
  try {
    if (sessionStorage.getItem(SS_OPEN) === '1' && signedIn()) {
      sessionStorage.removeItem(SS_OPEN);
      let n = 0; const t = setInterval(() => { if (openRithmic() || ++n > 80) clearInterval(t); }, 250);
    }
  } catch (e) {}

  Promise.resolve(rtReady()).then(() => { ready = true; sync(); }).catch(() => { ready = true; sync(); });
  setTimeout(() => { ready = true; sync(); }, 6000);   // never wait forever on the auth answer
  rtOnChange(sync);
  ['state:changed', 'layout:changed', 'cell:active'].forEach((ev) => { try { ws.on(ev, () => requestAnimationFrame(sync)); } catch (e) {} });
  if (opts.rith && opts.rith.client && opts.rith.client.on) opts.rith.client.on(sync);
  if (typeof ResizeObserver === 'function') { try { new ResizeObserver(() => { if (!pill.hidden) place(); }).observe(panel); } catch (e) {} }
  setInterval(() => { if (!document.hidden) sync(); }, 2000);

  const api = { sync, place, open: openSheet, close: closeSheet, hideToday, el: pill, sheet,
    // The amber data dot asks this: true = open this sheet instead of its plain tooltip.
    canOffer: (sym) => delayedViewer() && isCmeSymbol(sym) };
  window.STRYKER_DATA_BANNER = api;
  return api;
}
