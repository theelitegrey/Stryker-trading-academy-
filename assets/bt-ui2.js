/**
 * TradeZoro — Backtesting "new look" (UI 2), Owner 2026-10-26 ("backtest ui": make it simpler at
 * first sight without losing a feature; Apple / Google calm).
 *
 * OFF by default. Turned on by ?ui=2 on the backtest pages (remembered in localStorage
 * "stryker_bt_ui" = "2"); ?ui=1 goes back to the classic look and forgets the choice.
 *
 * It only MOVES existing elements (same ids, same listeners in replay.js) into calmer places and adds
 * a few helpers around them, so data and behaviour are identical in both looks:
 *   - essentials stay in sight: symbol + date, timeframe, Indicators, play / step / speed / Day,
 *     Sell · Qty stepper · Buy, a one-line "Stop 40 ticks · Target 2R" summary (tap to edit), P&L;
 *   - the rest lives in sheets, each at most 2 taps away: Chart settings (higher timeframe, NY / LDN
 *     shading, time zone, snapshot, sessions, data source, classic look), Draw (phone), and on a
 *     phone Positions / Ticket / Objects / Analytics as bottom sheets;
 *   - phone: one top bar (menu, title, market dot, full screen), the bottom nav behind a handle;
 *   - a first-run 3-step hint, dismissed once and remembered.
 * Pages: replay.html (workspace) and backtests.html (look only + hint). Depends on replay.js ids.
 * Tests: tools/tests/bt-regress.js with BT_Q=ui=2 (window.__btUi.reveal opens the sheet holding a
 * control, the way a member would).
 */
(function () {
  'use strict';
  const KEY = 'stryker_bt_ui', HINT = 'stryker_bt2_hint_done';
  const html = document.documentElement;
  let q = '';
  try { q = new URLSearchParams(location.search).get('ui') || ''; } catch (e) {}
  try {
    if (q === '2') localStorage.setItem(KEY, '2');
    else if (q === '1') localStorage.removeItem(KEY);
  } catch (e) {}
  let on = q === '2';
  if (!on && q !== '1') { try { on = localStorage.getItem(KEY) === '2'; } catch (e) {} }
  if (!on) return;
  html.classList.add('bt-ui2');

  const $ = (id) => document.getElementById(id);
  const PHONE = window.matchMedia('(max-width:900px)');
  const isPhone = () => PHONE.matches;
  const ico = (d, s) => '<svg width="' + (s || 18) + '" height="' + (s || 18) + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + '</svg>';
  const I = {
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
    sliders: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
    pen: '<path d="M4 20l4-1L19 8l-3-3L5 16z"/><path d="M14 7l3 3"/>',
    full: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
    exit: '<path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    minus: '<path d="M5 12h14"/>', plus: '<path d="M12 5v14M5 12h14"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>'
  };

  // ---------- generic sheet (bottom sheet on a phone, popover / panel on desktop) ----------
  let scrim = null;
  const openSheets = new Set();
  function ensureScrim() {
    if (scrim) return scrim;
    scrim = document.createElement('div'); scrim.className = 'bt2-scrim'; scrim.hidden = true;
    scrim.addEventListener('click', closeAll);
    document.body.appendChild(scrim);
    return scrim;
  }
  function syncScrim() { ensureScrim().hidden = !openSheets.size || !isPhone(); html.classList.toggle('bt2-sheet-open', !!openSheets.size); }
  // a sheet = { el, open(), close(), isOpen() }
  const sheets = {};
  function makeSheet(id, title, opts) {
    const el = document.createElement('div');
    el.className = 'bt2-sheet ' + ((opts && opts.cls) || ''); el.id = id; el.hidden = true;
    el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', title);
    el.innerHTML = '<div class="bt2-grab" aria-hidden="true"></div><div class="bt2-sheet-head"><b>' + title + '</b><button type="button" class="bt2-x" aria-label="Close">' + ico(I.close, 16) + '</button></div><div class="bt2-sheet-body"></div>';
    el.querySelector('.bt2-x').addEventListener('click', () => s.close());
    const s = {
      el, body: el.querySelector('.bt2-sheet-body'),
      isOpen: () => !el.hidden,
      open() { if (!el.hidden) return; closeAll(); el.hidden = false; openSheets.add(s); syncScrim(); if (opts && opts.onOpen) opts.onOpen(); if (s.btn) s.btn.classList.add('is-on'); },
      close() { if (el.hidden) return; el.hidden = true; openSheets.delete(s); syncScrim(); if (s.btn) s.btn.classList.remove('is-on'); },
      toggle() { if (el.hidden) s.open(); else s.close(); }
    };
    sheets[id] = s;
    return s;
  }
  // classic panes that act as sheets on a phone: the right drawer (Positions / Ticket / Objects) and
  // the Analytics sheet; their open state stays owned by replay.js (classes is-closed / is-open)
  function drawerOpen() { const d = $('rp-drawer'); return !!d && !d.classList.contains('is-closed'); }
  function closeDrawer() {
    const b = document.querySelector('#rp-drawerbtns [data-d].is-on');
    if (b) { b.click(); return; }
    // the classic page starts with the drawer open and no tab lit: same DOM result as replay.js setDrawer(null)
    const d = $('rp-drawer'); if (d) d.classList.add('is-closed');
  }
  function analyticsOpen() { const s = $('rp-sheet'); return !!s && s.classList.contains('is-open'); }
  function closeAnalytics() { if (analyticsOpen()) $('rp-sheet-toggle').click(); }
  function closeAll() {
    openSheets.forEach((s) => { s.el.hidden = true; if (s.btn) s.btn.classList.remove('is-on'); });
    openSheets.clear();
    if (isPhone()) { closeDrawer(); closeAnalytics(); }
    syncScrim(); syncPhonePanes();
  }
  function syncPhonePanes() {
    const work = $('rp-work'); const phonePane = isPhone() && !!work && !work.hidden && (drawerOpen() || analyticsOpen());
    html.classList.toggle('bt2-pane-open', phonePane);
    if (scrim) scrim.hidden = !(openSheets.size && isPhone()) && !phonePane;
  }

  // ---------- move helpers (phone-only moves go back when the window grows) ----------
  const moved = [];
  function moveInto(node, parent, before) {
    if (!node || !parent || parent.contains(node)) return;
    const ph = document.createComment('bt2 home');
    node.parentNode.insertBefore(ph, node);
    parent.insertBefore(node, before || null);
    moved.push({ node, ph });
  }
  function restoreMoved() { while (moved.length) { const m = moved.pop(); if (m.ph.parentNode) m.ph.parentNode.replaceChild(m.node, m.ph); } }

  // ---------- first-run hint (both pages) ----------
  function mountHint(host, before) {
    let done = false; try { done = localStorage.getItem(HINT) === '1'; } catch (e) {}
    if (done || !host || $('bt2-hint')) return;
    const h = document.createElement('div'); h.className = 'bt2-hint'; h.id = 'bt2-hint'; h.setAttribute('role', 'note');
    h.innerHTML = '<ol><li><b>1</b><span>Pick a day</span></li><li><b>2</b><span>Press play</span></li><li><b>3</b><span>Buy or Sell</span></li></ol>' +
      '<button type="button" class="bt2-hint-x" aria-label="Got it, hide these steps">Got it</button>';
    h.querySelector('.bt2-hint-x').addEventListener('click', () => { try { localStorage.setItem(HINT, '1'); } catch (e) {} h.remove(); });
    host.insertBefore(h, before || null);
  }

  // ---------- replay workspace ----------
  function mountReplay() {
    const top = document.querySelector('#rp-work .rpw-top'), opts = $('rp-opts'), tools = $('rp-tools');
    if (!top || !opts || !tools) return;
    const work = $('rp-work');
    new MutationObserver(() => { html.classList.toggle('bt2-work', !work.hidden); if (!work.hidden && isPhone()) setTimeout(() => { if (drawerOpen()) closeDrawer(); syncPhonePanes(); }, 0); /* a phone opens a session on the chart, not on a sheet */ syncPhonePanes(); }).observe(work, { attributes: true, attributeFilter: ['hidden'] });
    html.classList.toggle('bt2-work', !work.hidden);
    mountHint($('rp-app'), $('rp-home'));

    // top bar: [menu] title · timeframes · Indicators · [Draw] · Chart settings · [market dot] · full screen
    const menuBtn = document.createElement('button');
    menuBtn.type = 'button'; menuBtn.className = 'bt2-ib bt2-menu'; menuBtn.setAttribute('aria-label', 'Open menu'); menuBtn.innerHTML = ico(I.menu);
    menuBtn.addEventListener('click', (e) => { e.stopPropagation(); const t = $('dash-menu-toggle'); if (t) t.click(); });
    top.insertBefore(menuBtn, top.firstChild);

    const indBtn = $('rp-ind-btn');
    const actions = document.createElement('div'); actions.className = 'bt2-topact';
    if (indBtn) actions.appendChild(indBtn);
    const drawBtn = document.createElement('button'); drawBtn.type = 'button'; drawBtn.className = 'bt2-ib bt2-drawbtn'; drawBtn.title = 'Drawing tools'; drawBtn.setAttribute('aria-label', 'Drawing tools'); drawBtn.innerHTML = ico(I.pen);
    const setBtn = document.createElement('button'); setBtn.type = 'button'; setBtn.className = 'bt2-ib'; setBtn.id = 'bt2-set-btn'; setBtn.title = 'Chart settings'; setBtn.setAttribute('aria-label', 'Chart settings'); setBtn.innerHTML = ico(I.sliders);
    const clockSlot = document.createElement('span'); clockSlot.className = 'bt2-clock';
    const fsBtn = document.createElement('button'); fsBtn.type = 'button'; fsBtn.className = 'bt2-ib'; fsBtn.id = 'bt2-fs-btn'; fsBtn.title = 'Full screen'; fsBtn.setAttribute('aria-label', 'Full screen'); fsBtn.innerHTML = ico(I.full);
    actions.append(drawBtn, setBtn, clockSlot, fsBtn);
    const spacer = top.querySelector('.rpw-spacer');
    top.insertBefore(actions, spacer ? spacer.nextSibling : null);

    // Chart settings sheet: everything that was the loose options row, labelled, plus the page header's
    // links and the data source line
    const set = makeSheet('bt2-set', 'Chart settings', { cls: 'bt2-pop', onOpen: syncSrc });
    set.btn = setBtn; setBtn.addEventListener('click', (e) => { e.stopPropagation(); set.toggle(); });
    const row = (label, ...nodes) => { const r = document.createElement('div'); r.className = 'bt2-row'; const l = document.createElement('span'); l.className = 'bt2-row-l'; l.textContent = label; const v = document.createElement('div'); v.className = 'bt2-row-v'; nodes.forEach((n) => n && v.appendChild(n)); r.append(l, v); return r; };
    const split = $('rp-split'), htfSel = $('rp-htf-tf'), ny = $('rp-sess-ny'), ldn = $('rp-sess-ldn'), tz = $('rp-tz-live'), snap = $('rp-snap-btn');
    const group = split && split.closest('.rpw-group');
    set.body.append(
      row('Higher timeframe chart', group || (split && split.closest('label')), group ? null : htfSel),
      row('Session shading', ny && ny.closest('label'), ldn && ldn.closest('label')),
      row('Time zone', tz),
      row('Snapshot', snap)
    );
    if (snap && !snap.querySelector('.bt2-lbl')) { const t = document.createElement('span'); t.className = 'bt2-lbl'; t.textContent = 'Download PNG'; snap.appendChild(t); }
    const links = document.createElement('div'); links.className = 'bt2-links';
    links.innerHTML = '<a class="bt2-chip" href="backtests#sessions">All sessions</a><button type="button" class="bt2-chip" id="bt2-new">+ New session</button><a class="bt2-chip bt2-chip-quiet" href="?ui=1" id="bt2-classic">Classic look</a>';
    links.querySelector('#bt2-new').addEventListener('click', () => { set.close(); const b = $('rp-new-btn'); if (b) b.click(); });
    links.querySelector('#bt2-classic').addEventListener('click', (e) => { e.preventDefault(); try { localStorage.removeItem(KEY); } catch (x) {} const u = new URL(location.href); u.searchParams.set('ui', '1'); location.href = u.toString(); });
    const src = document.createElement('p'); src.className = 'bt2-src';
    set.body.append(row('Session', links), src);
    function syncSrc() { const r = $('rp-res'), s = $('rp-h1-sub'); src.textContent = 'Data: ' + ((r && r.textContent) || (s && s.textContent) || '—'); }
    opts.hidden = true;
    actions.appendChild(set.el);   // anchored under the button on desktop; a bottom sheet on a phone

    // Draw sheet (phone): the drawing rail; picking a tool closes it so the chart can be tapped
    const draw = makeSheet('bt2-draw', 'Draw', { cls: 'bt2-drawsheet' });
    draw.btn = drawBtn; drawBtn.addEventListener('click', (e) => { e.stopPropagation(); draw.toggle(); });
    tools.addEventListener('click', (e) => { if (draw.isOpen() && e.target.closest('button')) setTimeout(() => draw.close(), 0); });
    document.body.appendChild(draw.el);

    // Buy / Sell strip: qty stepper and a one-line stop / target summary; replay.js re-renders the
    // strip (innerHTML), so the helpers are re-added each time
    const strip = $('rp-tradebar-strip');
    function decorateStrip() {
      const qty = $('rp-strip-size');
      if (qty && !qty.parentNode.querySelector('.bt2-step')) {
        const wrap = document.createElement('span'); wrap.className = 'bt2-stepper';
        const mk = (dir) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'bt2-step'; b.setAttribute('aria-label', dir > 0 ? 'More contracts' : 'Fewer contracts'); b.innerHTML = ico(dir > 0 ? I.plus : I.minus, 16);
          b.addEventListener('click', () => { const st = Number(qty.step) || 1; const v = Math.max(st, Math.round(((Number(qty.value) || 0) + dir * st) / st) * st); qty.value = String(+v.toFixed(6)); qty.dispatchEvent(new Event('change', { bubbles: true })); }); return b; };
        qty.parentNode.insertBefore(wrap, qty); wrap.append(mk(-1), qty, mk(1));
      }
      const brk = strip.querySelector('.rp-sbrk');
      if (brk && !strip.querySelector('.bt2-risk')) {
        const sum = document.createElement('button'); sum.type = 'button'; sum.className = 'bt2-risk'; sum.setAttribute('aria-expanded', 'false');
        sum.addEventListener('click', () => { const o = !brk.classList.contains('bt2-open'); brk.classList.toggle('bt2-open', o); sum.setAttribute('aria-expanded', o ? 'true' : 'false'); });
        brk.parentNode.insertBefore(sum, brk);
        paintRisk();
      }
    }
    function paintRisk() {
      const sum = strip.querySelector('.bt2-risk'); if (!sum) return;
      const att = $('rp-strip-attach'), sl = $('rp-strip-sl'), tp = $('rp-strip-tp');
      const t = !att || att.checked ? 'Stop ' + ((sl && sl.value) || '—') + ' ticks · Target ' + ((tp && tp.value) || '—') + 'R' : 'No stop or target';
      sum.innerHTML = '<span>' + t + '</span>' + ico(I.edit, 14);
      sum.classList.toggle('is-off', !!att && !att.checked);
    }
    if (strip) {
      new MutationObserver(decorateStrip).observe(strip, { childList: true });
      strip.addEventListener('input', paintRisk); strip.addEventListener('change', paintRisk);
      decorateStrip();
    }

    // phone: one top bar; drawer buttons + Analytics become an action row under the account; the
    // drawer and the Analytics sheet open as bottom sheets; drawing rail into the Draw sheet
    const bottom = document.querySelector('#rp-work .rpw-bottom');
    const actRow = document.createElement('div'); actRow.className = 'bt2-actrow';
    const handle = document.createElement('button'); handle.type = 'button'; handle.className = 'bt2-handle'; handle.setAttribute('aria-label', 'Show the main menu bar'); handle.innerHTML = '<span aria-hidden="true"></span>';
    document.body.appendChild(handle);
    let navT = 0;
    function setNav(show) { clearTimeout(navT); html.classList.toggle('bt2-nav', !!show); if (show) navT = setTimeout(() => setNav(false), 4000); }
    handle.addEventListener('click', (e) => { e.stopPropagation(); setNav(!html.classList.contains('bt2-nav')); });
    ['#appnav-dock', '.bta-rail'].forEach((s) => document.addEventListener('pointerdown', (e) => { if (e.target.closest(s) && html.classList.contains('bt2-nav')) setNav(true); }, true));
    function layout() {
      restoreMoved();
      html.classList.toggle('bt2-phone', isPhone());
      if (isPhone()) {
        if (bottom) { bottom.appendChild(actRow); moveInto($('rp-drawerbtns'), actRow); moveInto($('rp-sheet-toggle'), actRow); }
        moveInto(tools, draw.body);
        const mc = $('mclock'); if (mc) moveInto(mc, clockSlot);
        const bell = document.querySelector('.mobile-topnav .notif-bell-wrap'); if (bell) moveInto(bell, clockSlot);
        if (drawerOpen()) closeDrawer();
      } else { draw.close(); if (actRow.parentNode) actRow.remove(); }
      syncScrim(); syncPhonePanes();
    }
    PHONE.addEventListener('change', layout);
    layout();
    // the market clock is mounted by market-hours.js a moment after load
    let tries = 0; const t = setInterval(() => { tries++; const mc = $('mclock'); if ((mc && isPhone() && !clockSlot.contains(mc)) ) { layout(); } if (tries > 20 || (mc && (clockSlot.contains(mc) || !isPhone()))) clearInterval(t); }, 300);

    // keep the phone panes (classic drawer / analytics) in step with the scrim
    const dr = $('rp-drawer'), sh = $('rp-sheet');
    [dr, sh].forEach((n) => n && new MutationObserver(() => { if (isPhone() && (drawerOpen() || analyticsOpen())) { openSheets.forEach((s) => s.close()); } syncPhonePanes(); }).observe(n, { attributes: true, attributeFilter: ['class'] }));
    // only one phone pane at a time: opening Analytics closes the drawer and vice versa
    document.addEventListener('click', (e) => {
      if (!isPhone()) return;
      if (e.target.closest('#rp-sheet-toggle') && drawerOpen()) closeDrawer();
      if (e.target.closest('#rp-drawerbtns [data-d]') && analyticsOpen()) closeAnalytics();
    }, true);
    [dr, sh].forEach((n) => { if (!n) return; const g = document.createElement('button'); g.type = 'button'; g.className = 'bt2-panex'; g.setAttribute('aria-label', 'Close'); g.innerHTML = ico(I.close, 16); g.addEventListener('click', closeAll); n.insertBefore(g, n.firstChild); });

    // full screen (phone + desktop): only the workspace
    fsBtn.addEventListener('click', () => {
      const fs = !html.classList.contains('bt2-fs'); html.classList.toggle('bt2-fs', fs);
      fsBtn.innerHTML = ico(fs ? I.exit : I.full); fsBtn.title = fs ? 'Exit full screen' : 'Full screen'; fsBtn.setAttribute('aria-label', fsBtn.title);
      window.scrollTo(0, 0);
      setTimeout(() => window.dispatchEvent(new Event('resize')), 60);
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && openSheets.size) closeAll(); });
    document.addEventListener('click', (e) => { if (!isPhone() && set.isOpen() && !set.el.contains(e.target) && !e.target.closest('#bt2-set-btn')) set.close(); });

    // test / automation hook: open whatever holds a control, return the taps it took
    window.__btUi = {
      reveal(sel) {
        const n = document.querySelector(sel); if (!n) return 0;
        let taps = 0;
        const inSheet = Object.values(sheets).find((s) => s.el.contains(n));
        const inDrawer = $('rp-drawer') && $('rp-drawer').contains(n);
        const inAnalytics = sh && sh.contains(n);
        const inStripRisk = n.closest && n.closest('.rp-sbrk');
        // close what covers it
        openSheets.forEach((s) => { if (s !== inSheet) { s.close(); taps++; } });
        if (isPhone() && drawerOpen() && !inDrawer) { closeDrawer(); taps++; }
        if (isPhone() && analyticsOpen() && !inAnalytics && !n.closest('#rp-sheet-toggle')) { closeAnalytics(); taps++; }
        if (inSheet && !inSheet.isOpen()) { inSheet.open(); taps++; }
        if (inDrawer) { const pane = n.closest('.rpw-pane'); const k = pane && pane.id.replace('rp-pane-', ''); const b = k && document.querySelector('#rp-drawerbtns [data-d="' + k + '"]'); if (b && (!b.classList.contains('is-on'))) { b.click(); taps++; } }
        if (inAnalytics && !analyticsOpen()) { $('rp-sheet-toggle').click(); taps++; }
        if (inStripRisk && !inStripRisk.classList.contains('bt2-open')) { const s = strip.querySelector('.bt2-risk'); if (s) { s.click(); taps++; } }
        return taps;
      },
      closeAll
    };
  }

  // ---------- backtests dashboard: look + hint only ----------
  function mountDashboard() {
    const app = $('bt-app'); if (!app) return;
    mountHint(app, app.querySelector('.bta-head') ? app.querySelector('.bta-head').nextSibling : app.firstChild);
    const head = app.querySelector('.bta-actions');
    if (head && !$('bt2-classic')) { const a = document.createElement('a'); a.href = '?ui=1'; a.id = 'bt2-classic'; a.className = 'bt2-chip bt2-chip-quiet'; a.textContent = 'Classic look'; head.insertBefore(a, head.firstChild); }
  }

  function start() { if ($('rp-work')) mountReplay(); else mountDashboard(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
