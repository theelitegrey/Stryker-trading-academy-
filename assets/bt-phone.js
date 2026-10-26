/**
 * TradeZoro — Backtest on a PHONE, on our chart (replay.html, Vela chart only)
 * Owner 2026-10-26: "why is it not full screen like other pages?"
 *
 * While a session is open on a phone (<= 700 px) the page behaves like the Charts page (builds 664/666/668):
 *   - body gets .charts-page, so the Charts phone rules apply: no site header, bottom nav behind the handle,
 *     ONE top bar (the chart bar), full screen button (html.stk-chart-fs), no page scroll;
 *   - the chart takes all the free height; under it ONE compact dock:
 *       row 1  play · +1 · +10 · speed · Day      row 2  Sell · qty · Buy      row 3  one-line summary (opens the sheet)
 *   - the pull-up sheet holds everything else (nothing removed): Stop/Target, Balance/Equity/P&L, Positions / Ticket /
 *     Objects, Analytics, NY ›, bar position, chart settings (HTF, NY/LDN shading, time zone, snapshot).
 * Everything moved goes back to its place when the session closes or the window grows. Simulated only.
 * Education only. Not financial advice.
 */
(function () {
  'use strict';
  var PHONE_MAX = 700;
  var html = document.documentElement, body = document.body;
  var $ = function (id) { return document.getElementById(id); };
  var moved = [];          // [{ node, ph }]
  var sheet = null, summary = null, on = false;

  function isPhone() { return window.innerWidth <= PHONE_MAX; }
  function moveInto(node, parent) {
    if (!node || !parent || parent.contains(node)) return;
    var ph = document.createComment('bt-phone home'); node.parentNode.insertBefore(ph, node); parent.appendChild(node); moved.push({ node: node, ph: ph });
  }
  function restore() { while (moved.length) { var m = moved.pop(); if (m.ph.parentNode) m.ph.parentNode.replaceChild(m.node, m.ph); } }

  function buildSheet() {
    if (sheet) return;
    sheet = document.createElement('div'); sheet.id = 'bt-psheet'; sheet.className = 'bt-psheet'; sheet.hidden = true; sheet.setAttribute('role', 'dialog'); sheet.setAttribute('aria-label', 'Trade details');
    sheet.innerHTML = '<div class="bt-psheet-grab" aria-hidden="true"></div>' +
      '<div class="bt-psheet-h"><b>Trade details</b><button type="button" class="bt-psheet-x" aria-label="Close">\u2715</button></div>' +
      '<div class="bt-psheet-b">' +
      '<section data-s="brk"><h4>Stop / Target</h4><div class="bt-slot" data-slot="brk"></div></section>' +
      '<section data-s="acct"><h4>Account</h4><div class="bt-slot" data-slot="acct"></div></section>' +
      '<section data-s="act"><h4>Orders, analytics, objects</h4><div class="bt-slot" data-slot="act"></div></section>' +
      '<section data-s="more"><h4>Replay</h4><div class="bt-slot" data-slot="more"></div></section>' +
      '<section data-s="set"><h4>Chart settings</h4><div class="bt-slot" data-slot="set"></div></section>' +
      '</div>';
    sheet.querySelector('.bt-psheet-x').addEventListener('click', closeSheet);
    body.appendChild(sheet);
    summary = document.createElement('button'); summary.type = 'button'; summary.id = 'bt-psum'; summary.className = 'bt-psum';
    summary.addEventListener('click', function () { if (sheet.hidden) openSheet(); else closeSheet(); });
  }
  function slot(n) { return sheet.querySelector('[data-slot="' + n + '"]'); }
  function openSheet() { sheet.hidden = false; html.classList.add('bt-psheet-open'); summary.setAttribute('aria-expanded', 'true'); }
  function closeSheet() { if (!sheet) return; sheet.hidden = true; html.classList.remove('bt-psheet-open'); if (summary) summary.setAttribute('aria-expanded', 'false'); }

  function gather() {
    var strip = $('rp-tradebar-strip'), brk = strip && strip.querySelector('.rp-sbrk');
    if (brk) moveInto(brk, slot('brk'));
    moveInto($('rp-acct'), slot('acct'));
    moveInto($('rp-drawerbtns'), slot('act')); moveInto($('rp-sheet-toggle'), slot('act'));
    moveInto($('rp-jumpny'), slot('more')); var cur = document.querySelector('#rp-float .rp-cursor'); moveInto(cur, slot('more'));
    if (html.classList.contains('bt-ui2')) {
      // ui2 already owns the chart settings sheet: a button opens it
      if (!slot('set').firstChild) { var b = document.createElement('button'); b.type = 'button'; b.className = 'rpw-btn'; b.textContent = 'Open chart settings'; b.addEventListener('click', function () { closeSheet(); var s = $('bt2-set-btn'); if (s) s.click(); }); slot('set').appendChild(b); }
    } else { moveInto($('rp-opts'), slot('set')); var o = $('rp-opts'); if (o) o.hidden = false; }
  }

  function paintSummary() {
    if (!summary) return;
    var g = function (id) { var e = $(id); return e ? e.textContent.trim() : '\u2014'; };
    summary.innerHTML = '<span>Equity ' + g('rp-acc-equity') + ' \u00b7 P&amp;L ' + g('rp-acc-net') + '</span><i aria-hidden="true">\u25B4</i>';
  }

  function enter() {
    if (on) return; on = true; buildSheet();
    html.classList.add('bt-tzp'); body.classList.add('charts-page');
    var bottom = document.querySelector('#rp-work .rpw-bottom'); if (bottom && summary.parentNode !== bottom) bottom.appendChild(summary);
    gather(); paintSummary();
    // the classic page starts with the right drawer open: on a phone it is a sheet and starts closed
    var d = $('rp-drawer'); if (d && !d.classList.contains('is-closed')) d.classList.add('is-closed');
    try { window.dispatchEvent(new Event('resize')); } catch (e) {}
  }
  function leave() {
    if (!on) return; on = false; closeSheet(); restore();
    html.classList.remove('bt-tzp', 'stk-chart-fs'); body.classList.remove('charts-page');
    try { window.dispatchEvent(new Event('resize')); } catch (e) {}
  }
  function sync() {
    var work = $('rp-work'); var want = isPhone() && !!work && !work.hidden && html.classList.contains('bt-tz');
    if (want) enter(); else leave();
  }

  function init() {
    var work = $('rp-work'); if (!work) return;
    new MutationObserver(sync).observe(work, { attributes: true, attributeFilter: ['hidden'] });
    window.addEventListener('resize', sync); window.addEventListener('orientationchange', sync);
    // the Buy / Sell strip is rebuilt by replay.js (innerHTML): the stop / target block goes back into the sheet each time
    var strip = $('rp-tradebar-strip'); if (strip) new MutationObserver(function () { if (on) { gather(); } }).observe(strip, { childList: true });
    setInterval(function () { if (on) paintSummary(); }, 500);
    // opening a drawer pane / analytics closes the pull-up sheet (they are sheets of their own)
    document.addEventListener('click', function (e) { if (on && e.target.closest && e.target.closest('#rp-drawerbtns button, #rp-sheet-toggle')) closeSheet(); }, true);
    sync();
  }
  // the chart adapter adds html.bt-tz while booting: start once the page is ready
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  window.BtPhone = { sync: sync, open: openSheet, close: closeSheet };
})();
