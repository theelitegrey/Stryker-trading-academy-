// TradeZoro — Charts single toolbar (ES module, charts.html only)
// Owner order 2026-10-14: "combine the two menus, taking space of chart".
//
// Before: two bars. Ours (#stkc-bar: layout, grid, Templates, Pine | Replay, Trade, Connect
// broker, price alerts, settings, Credits) and Vela's own .vela-widget-topbar inside the chart
// (symbol, intervals, chart style, Indicators, undo/redo | alert log, data window, object tree,
// screenshot). After: on a desktop-mode chart Vela's bar ELEMENT is moved into #stkc-bar, so the
// chart grid gets the height of the second row.
//
// Nothing is rebuilt: every button keeps its node, id, listeners, test hooks and shortcuts.
//   - The moved bar, .stkc-bar-l and .stkc-bar-r are display:contents in merged mode
//     (style.css, #stkc-bar.stkc-onebar), and each item gets a CSS `order`: symbol, intervals,
//     style, Indicators, undo/redo, then our layout group; right: Replay, Trade, Connect broker,
//     price alerts + Vela's alert log side by side (both kept: one opens the price-alert manager,
//     the other Vela's log of fired alerts), data window, object tree, screenshot, settings,
//     Credits, ⋯ More.
//   - Vela's colour tokens are inline custom properties on its root (.vela-ui); they are copied
//     onto the moved bar and the More menu, and re-copied when the root's style changes (theme).
//   - Vela routes plain typing (letter = symbol search, digit = interval) from its root's keydown;
//     keys pressed while focus is on a moved Vela button are forwarded to the same router.
//   - When Vela flips to its phone layout (data-layout="mobile": narrow, or a touch tablet) the
//     bar goes back to its original spot, where Vela hides it in favour of its bottom bar, and
//     #stkc-bar is the phone row it was before.
//
// Fitting (both modes): never wraps, never clips. While the items are wider than the bar, steps
// apply in this order (Owner: layout/Templates/info first, then Replay/Trade labels): Credits,
// Templates, layout menu, grid button -> ⋯ More; Replay / Trade / Connect broker labels hidden;
// interval chips collapse to the active one (chart-intervals.js listens for "stkc:onebar-fit");
// then data window / object tree, screenshot, Connect broker, Pine, settings -> ⋯ More.
// Every pass starts from scratch: moved items return to their exact spot (comment placeholder).
//
// TRADINGVIEW LAYOUT (Owner order 2026-10-14, part 2, "same as tradingview", inspired not copied):
// left  symbol | intervals | chart type | Indicators, Templates, Pine | Alert, Replay | undo, redo;
// right layout name | grid | settings, fullscreen, screenshot | Trade, Connect broker | info, ⋯.
// Vela's alert log, data window and object tree moved to the right icon bar (chart-tv-toolbars.js).
// Phone: Vela's bottom bar becomes the start of this one top row (symbol, interval, Indicators,
// drawing pencil); the rest folds into ⋯ More.
//
// Depends on: vela-chart.js (ws = VelaWorkspace: ws.root, ws.topbar.el, ws.layoutCtl,
// ws.routeTyping), style.css (.stkc-onebar / .stkc-ob-* block), chart-intervals.js (fit event).

const byId = (id) => document.getElementById(id);
function menuOf(id){
  const b = byId(id);
  return b && b.parentElement && b.parentElement.classList.contains('stkc-menu') ? b.parentElement : b;
}
const q = (s) => document.querySelector('#stkc-bar ' + s);

// [kind, arg]: 'more' moves the nodes into ⋯ More, 'cls' adds a class to the bar.
// TradingView-style order (Owner order 2026-10-14 part 2): extras first, then labels, then chips,
// then the right-side icons; on the phone row (Vela's bar moved in, see mergePhone) the last steps
// leave symbol, interval, Indicators, the pencil and ⋯.
const STEPS = [
  ['more', () => [byId('stkc-credits-btn'), byId('stkc-credits')]],
  ['more', () => [menuOf('stkc-tpl-btn')]],
  ['more', () => [byId('stkc-pine-btn')]],
  ['more', () => [byId('stkc-fs-btn')]],
  ['more', () => [menuOf('stkl-btn')]],
  ['more', () => [menuOf('stkc-layout-btn')]],
  ['cls', 'stkc-ob-nolabel'],
  ['cls', 'stkc-ob-ivn'],
  ['more', () => [q('.vela-widget-screenshot')]],
  ['more', () => [byId('stkrb-chip'), menuOf('stkrb-btn')]],
  ['more', () => [byId('stkc-settings-btn')]],
  ['more', () => [q('.vela-mb-maximize')]],
  ['more', () => [q('.stknw-phonebtn')]],
  ['more', () => [q('.stkgl-phonebtn')]],
  ['more', () => [q('.stkw-phonebtn')]],
  ['more', () => [byId('stkc-alerts-btn')]],
  ['more', () => [q('.stkr-menu'), q('.stkr-badge')]],
  ['more', () => [q('.vela-widget-undo'), q('.vela-widget-redo')]],
  ['more', () => [q('.vela-mb-more')]],
  ['more', () => [byId('stkc-paper-btn')]]
];
// Thin dividers between the TradingView groups (CSS `order` puts each in place; style.css).
// A divider with no visible item on one side (its group went to ⋯ More) is switched off by fit().
const DIVIDERS = [2, 4, 6, 9, 12, 21, 23, 27, 31];
const CLASSES = STEPS.filter((s) => s[0] === 'cls').map((s) => s[1]);

// PHONE ⋯ LIST (Owner 2026-10-26: "Fix this chart extra menu in mobile. Add appropriate text and
// align properly"). On the phone row (not merged) ⋯ More is a clean list: every row = a 20 px icon
// in a fixed 24 px column + a text label, one left edge, 44 px rows, grouped Chart / Tools / Panels
// under thin dividers; it fits the screen and scrolls when taller. The moved node keeps its own
// button (listeners, popover, ids); only its look changes, through data-ob-* attributes + CSS
// (style.css, .stkc-ob-list) that are removed again when it goes back to the bar. Desktop's ⋯ More
// (merged bar) is not touched.
// [match(node) -> trigger, group, order, label(trigger), icon]
const IC = {
  layout: '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M3.5 9h17"/>',
  grid: '<rect x="3.5" y="3.5" width="17" height="17" rx="2"/><path d="M12 3.5v17M3.5 12h17"/>',
  tpl: '<path d="M6 4h12v16l-6-4-6 4z"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  fs: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  fsOff: '<path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/>',
  max: '<path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7"/>',
  dots: '<circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/>',
  replay: '<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/><path d="M10 9l5 3-5 3z"/>',
  alarm: '<circle cx="12" cy="13" r="7.5"/><path d="M12 9v4l2.5 2M4 4.5 6.5 2.5M20 4.5 17.5 2.5"/>',
  pine: '<path d="M12 2.5 6.5 9h3L5 15h4.5L5.5 20h13L14.5 15H19l-4.5-6h3z"/><path d="M12 20v2"/>',
  link: '<path d="M9 7H7a5 5 0 0 0 0 10h2M15 7h2a5 5 0 0 1 0 10h-2M8 12h8"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  redo: '<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>',
  shot: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  trade: '<path d="M4 17l5-5 4 4 7-8"/><path d="M15 8h5v5"/>',
  news: '<path d="M4 5h13v14H6a2 2 0 0 1-2-2z"/><path d="M17 9h3v8a2 2 0 0 1-2 2"/><path d="M7.5 9h6M7.5 12.5h6M7.5 16h4"/>',
  list: '<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/>',
  ladder: '<path d="M7 3v18M17 3v18M7 7h10M7 12h10M7 17h10"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5h.01"/>'
};
const trig = (n) => (n.classList.contains('stkc-menu') ? n.querySelector(':scope > button') : n);
const ROWS = [
  // CHART
  [(n) => n.classList.contains('stkl-menu') && trig(n), 'chart', 1, (t) => 'Layout: ' + ((t.querySelector('.stkl-name') || t).textContent.replace(/^Viewing:\s*/, '').trim() || 'Unsaved'), 'layout'],
  [(n) => n.querySelector && n.querySelector(':scope > #stkc-layout-btn'), 'chart', 2, (t) => { const m = /(\d+)/.exec((t.querySelector('.stkc-btn-l') || t).textContent || ''); return 'Charts in layout (' + (m ? m[1] : 1) + ')'; }, 'grid'],
  [(n) => n.querySelector && n.querySelector(':scope > #stkc-tpl-btn'), 'chart', 3, () => 'Templates', 'tpl'],
  [(n) => n.id === 'stkc-settings-btn' && n, 'chart', 4, () => 'Chart settings', 'gear'],
  [(n) => n.id === 'stkc-fs-btn' && n, 'chart', 5, () => (document.documentElement.classList.contains('stk-chart-fs') ? 'Exit full screen' : 'Full screen'), 'fs'],
  [(n) => n.classList.contains('vela-mb-maximize') && n, 'chart', 6, () => 'Maximize / restore chart', 'max'],
  [(n) => n.classList.contains('vela-mb-more') && n, 'chart', 7, () => 'Object tree & chart menu', 'dots'],
  // TOOLS
  [(n) => n.classList.contains('stkr-menu') && trig(n), 'tools', 11, () => 'Replay', 'replay'],
  [(n) => n.id === 'stkc-alerts-btn' && n, 'tools', 12, () => 'Alerts', 'alarm'],
  [(n) => n.id === 'stkc-pine-btn' && n, 'tools', 13, () => 'Pine Script editor', 'pine'],
  // Rithmic: a DATA-ONLY connection (rithmic-config.js: never places, changes or cancels orders)
  [(n) => n.querySelector && n.querySelector(':scope > #stkrb-btn'), 'tools', 14, () => 'Connect data (Rithmic)', 'link'],
  [(n) => n.id === 'stkc-paper-btn' && n, 'tools', 15, () => 'Paper trading', 'trade'],
  [(n) => n.classList.contains('vela-widget-undo') && n, 'tools', 16, () => 'Undo', 'undo'],
  [(n) => n.classList.contains('vela-widget-redo') && n, 'tools', 17, () => 'Redo', 'redo'],
  [(n) => n.classList.contains('vela-widget-screenshot') && n, 'tools', 18, () => 'Screenshot', 'shot'],
  // PANELS
  [(n) => n.classList.contains('stknw-phonebtn') && n, 'panels', 21, () => 'News', 'news'],
  [(n) => n.classList.contains('stkw-phonebtn') && n, 'panels', 22, () => 'Watchlist', 'list'],
  [(n) => n.classList.contains('stkgl-phonebtn') && n, 'panels', 23, () => 'GEX Ladder', 'ladder'],
  [(n) => n.id === 'stkc-credits-btn' && n, 'panels', 24, () => 'Data source & credits', 'info']
];
const GROUP_ORDER = { chart: 0, tools: 10, panels: 20 };
const GROUP_LABEL = { chart: 'Chart', tools: 'Tools', panels: 'Panels' };
const icUrl = (k) => 'url("data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + IC[k] + '</svg>') + '")';

export function mountOneBar(ws){
  const bar = byId('stkc-bar');
  const barL = byId('stkc-bar-l');
  const barR = bar && bar.querySelector('.stkc-bar-r');
  const tb = ws && ws.topbar && ws.topbar.el;
  const root = ws && ws.root;
  if (!bar || !barL || !barR || !tb || !root) return null;

  const home = document.createComment('vela topbar home');
  tb.parentNode.insertBefore(home, tb);

  const spacer = document.createElement('span');
  spacer.className = 'stkc-ob-sp';
  spacer.setAttribute('aria-hidden', 'true');
  const divs = DIVIDERS.map((o) => {
    const d = document.createElement('span');
    d.className = 'stkc-tv-div';
    d.setAttribute('aria-hidden', 'true');
    d.style.order = String(o);
    bar.appendChild(d);
    return d;
  });

  // Phone (Vela's mobile layout): Vela's bottom bar (symbol, interval, Indicators, the drawing
  // pencil, ⋯ chart menu, maximize, settings) moves to the START of #stkc-bar, so the phone has
  // ONE slim top row like TradingView's app and the chart gets the bottom bar's height.
  const mb = (ws.mobileBar && ws.mobileBar.el) || root.querySelector('.vela-mobilebar');
  const mbHome = mb ? document.createComment('vela mobilebar home') : null;
  if (mb) mb.parentNode.insertBefore(mbHome, mb);

  // ⋯ More
  const moreBtn = document.createElement('button');
  moreBtn.type = 'button';
  moreBtn.className = 'stkc-ib stkc-ob-more-btn';
  moreBtn.id = 'stkc-more-btn';
  moreBtn.title = 'More';
  moreBtn.setAttribute('aria-label', 'More toolbar items');
  moreBtn.setAttribute('aria-haspopup', 'true');
  moreBtn.setAttribute('aria-expanded', 'false');
  moreBtn.setAttribute('aria-controls', 'stkc-more-pop');
  moreBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>';
  const morePop = document.createElement('div');
  // Not .stkc-pop: the Connect-broker button closes every .stkc-pop when it opens its own, and
  // that must not close the menu it sits in.
  morePop.className = 'stkc-ob-pop';
  morePop.id = 'stkc-more-pop';
  morePop.setAttribute('role', 'group');
  morePop.setAttribute('aria-label', 'More toolbar items');
  morePop.hidden = true;
  // group headings for the phone list (hidden in the desktop ⋯ More)
  const heads = {};
  Object.keys(GROUP_LABEL).forEach((g) => {
    const h = document.createElement('div');
    h.className = 'stkc-ob-gh';
    h.setAttribute('role', 'presentation');
    h.textContent = GROUP_LABEL[g];
    h.style.order = String(GROUP_ORDER[g]);
    h.hidden = true;
    heads[g] = h;
    morePop.appendChild(h);
  });
  // phone list: while a menu opened from it is showing, the list itself steps back (style.css .stkc-ob-sub)
  const subOpen = () => !!morePop.querySelector('.stkc-pop:not([hidden]), #stkc-credits:not([hidden])');
  new MutationObserver(() => { morePop.classList.toggle('stkc-ob-sub', !merged && !morePop.hidden && subOpen()); })
    .observe(morePop, { subtree: true, attributes: true, attributeFilter: ['hidden'] });
  // phone list: a row that does its job in place (opens a sheet / panel / editor, toggles full
  // screen) closes the list, even when its button stops the click; a row that opens a menu inside
  // the list (Templates, Layout, Charts in layout, Replay, Credits) keeps it, as the sub-menu
  morePop.addEventListener('click', (e) => {
    if (merged || !e.target.closest || !e.target.closest('[data-ob-trig]')) return;
    setTimeout(() => { if (!morePop.hidden && !subOpen()) setMore(false); }, 0);
  }, true);
  const more = document.createElement('div');
  more.className = 'stkc-menu stkc-ob-more';
  more.hidden = true;
  more.append(moreBtn, morePop);
  const setMore = (open) => {
    // phone list: room from just under the toolbar to the bottom of the screen; taller lists scroll
    if (open && !merged) {
      const b = bar.getBoundingClientRect().bottom;
      // just under the toolbar (never over it), whatever the ⋯ button's height
      morePop.style.top = Math.ceil(b - more.getBoundingClientRect().top + 4) + 'px';
      morePop.style.setProperty('--ob-maxh', Math.max(160, Math.floor(window.innerHeight - b - 14)) + 'px');
      morePop.scrollTop = 0;
    } else if (merged) morePop.style.removeProperty('top');
    if (!open) morePop.classList.remove('stkc-ob-sub');
    morePop.hidden = !open; moreBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
  };
  moreBtn.addEventListener('click', (e) => { e.stopPropagation(); setMore(morePop.hidden); });
  // Items that open their own popover (Templates, Credits, grid, layout menu) stop the click's
  // propagation, so More stays open around them; any other click (an action, or outside) closes it.
  document.addEventListener('click', () => { if (!morePop.hidden) setMore(false); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !morePop.hidden) setMore(false); });

  barR.insertBefore(spacer, barR.firstChild);
  barR.appendChild(more);

  // tokens + font from Vela's root
  const copyTokens = () => {
    const st = root.style;
    let font = '';
    try { font = getComputedStyle(root).fontFamily; } catch (e) {}
    [tb, morePop, mb].filter(Boolean).forEach((n) => {
      for (let i = 0; i < st.length; i++) {
        const k = st[i];
        if (k.startsWith('--vela')) n.style.setProperty(k, st.getPropertyValue(k));
      }
    });
    if (font) tb.style.fontFamily = font;
  };
  new MutationObserver(() => { if (merged) copyTokens(); }).observe(root, { attributes: true, attributeFilter: ['style', 'class'] });

  // plain typing on a moved Vela button -> Vela's router (symbol search / interval)
  const route = (ev) => {
    if (!merged || root.contains(ev.target)) return;
    if (!ev.target.closest || !ev.target.closest('.vela-widget-topbar, [data-ob-vela]')) return;
    try { if (typeof ws.routeTyping === 'function') ws.routeTyping(ev); } catch (e) {}
  };
  tb.addEventListener('keydown', route);
  morePop.addEventListener('keydown', route);

  let merged = false;
  const moved = [];   // [{ node, ph }]

  function restoreMoved(){
    while (moved.length) {
      const m = moved.pop();
      if (m.ph.parentNode) m.ph.parentNode.replaceChild(m.node, m.ph);
      m.node.removeAttribute('data-ob-more');
      m.node.removeAttribute('data-ob-vela');
      unlist(m.node);
    }
    Object.values(heads).forEach((h) => { h.hidden = true; });
    morePop.classList.remove('stkc-ob-list');
  }
  function unlist(n){
    n.removeAttribute('data-ob-row');
    n.style.removeProperty('order');
    const t = n.__obTrig;
    if (t) { t.removeAttribute('data-ob-trig'); t.removeAttribute('data-ob-label'); t.style.removeProperty('--ob-ic'); n.__obTrig = null; }
  }
  // phone list: label + icon + group on every moved item
  function listify(){
    if (merged) return;
    morePop.classList.add('stkc-ob-list');
    const used = {};
    moved.forEach(({ node }) => {
      for (const [match, g, ord, label, ic] of ROWS) {
        const t = match(node);
        if (!t) continue;
        node.setAttribute('data-ob-row', g);
        node.style.order = String(ord);
        t.setAttribute('data-ob-trig', '1');
        t.setAttribute('data-ob-label', label(t));
        const icon = ic === 'fs' && document.documentElement.classList.contains('stk-chart-fs') ? 'fsOff' : ic;
        t.style.setProperty('--ob-ic', icUrl(icon));
        node.__obTrig = t;
        used[g] = true;
        return;
      }
    });
    moved.forEach(({ node }) => { if (!node.hasAttribute('data-ob-row') && !node.matches('#stkc-credits')) node.style.order = '30'; });
    Object.keys(heads).forEach((g) => { heads[g].hidden = !used[g]; });
  }
  function moveToMore(nodes){
    let any = false;
    nodes.forEach((n) => {
      if (!n || !n.isConnected || !bar.contains(n) || morePop.contains(n) || n.contains(more)) return;
      if (n.hidden || getComputedStyle(n).display === 'none') return;
      const ph = document.createComment('onebar');
      n.parentNode.insertBefore(ph, n);
      const wide = n.classList.contains('stkc-menu') || !!n.querySelector('.stkc-btn-l') || n.id === 'stkc-credits' || n.id === 'stkrb-chip';
      n.setAttribute('data-ob-more', wide ? 'row' : 'icon');
      if (tb.contains(n)) n.setAttribute('data-ob-vela', '1');
      morePop.appendChild(n);
      moved.push({ node: n, ph });
      any = true;
    });
    return any;
  }

  // Do the visible items need more room than the bar has?
  function flexItems(p, out){
    for (const c of p.children) {
      const cs = getComputedStyle(c);
      if (cs.display === 'contents') { flexItems(c, out); continue; }
      if (cs.display === 'none' || cs.position === 'absolute' || cs.position === 'fixed') continue;
      out.push(c);
    }
    return out;
  }
  function need(box){
    const cs = getComputedStyle(box);
    const its = flexItems(box, []).filter((c) => c !== spacer);
    let w = Math.max(0, its.length - 1) * (parseFloat(cs.columnGap) || 0);
    its.forEach((c) => {
      const s = getComputedStyle(c);
      w += c.getBoundingClientRect().width + parseFloat(s.marginLeft) + parseFloat(s.marginRight);
    });
    return w;
  }
  function overflows(){
    const cs = getComputedStyle(bar);
    const room = bar.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    // need() misses the layout-group hairline and the spacer's floor, so the bar's own
    // scrollWidth (items never shrink) is the second, exact test.
    // (not bar.scrollWidth: an open popover of a right-hand menu sticks out past the bar and
    // would read as overflow; the items' own right edge is the exact test)
    if (merged) {
      const right = bar.getBoundingClientRect().right - parseFloat(cs.paddingRight);
      const edge = flexItems(bar, []).reduce((m, c) => Math.max(m, c.getBoundingClientRect().right), 0);
      return need(bar) > room + 0.5 || edge > right + 1;
    }
    // phone row: neither half (nor the bar) may overflow its box
    return [bar, barL, barR].some((b) => b.scrollWidth > b.clientWidth + 1);
  }

  // A divider shows only between two visible items (never first, last, twice, or by the spacer).
  function tidyDividers(){
    divs.forEach((d) => d.classList.remove('stkc-tv-off'));
    if (!merged) return;
    const its = flexItems(bar, []).filter((c) => c.getBoundingClientRect().width > 0 || c === spacer)
      .map((c) => ({ c, o: parseFloat(getComputedStyle(c).order) || 0, x: c.getBoundingClientRect().left }))
      .sort((a, b) => a.o - b.o || a.x - b.x).map((e) => e.c);
    let prevReal = false;
    its.forEach((c, i) => {
      if (c === spacer) { prevReal = false; return; }
      if (!divs.includes(c)) { prevReal = true; return; }
      let nextReal = false;
      for (let j = i + 1; j < its.length; j++) { if (its[j] === spacer) break; if (!divs.includes(its[j])) { nextReal = true; break; } }
      if (!prevReal || !nextReal) c.classList.add('stkc-tv-off');
      else prevReal = false;
    });
  }

  let fitting = false;
  function fit(){
    if (fitting) return;
    fitting = true;
    try {
      const wasOpen = !morePop.hidden;
      restoreMoved();
      CLASSES.forEach((c) => bar.classList.remove(c));
      more.hidden = true;
      document.dispatchEvent(new CustomEvent('stkc:onebar-fit'));
      for (const [kind, arg] of STEPS) {
        if (!overflows()) break;
        if (kind === 'cls') { bar.classList.add(arg); document.dispatchEvent(new CustomEvent('stkc:onebar-fit')); }
        else if (moveToMore(arg())) more.hidden = false;
      }
      listify();
      if (more.hidden) setMore(false); else if (wasOpen) setMore(true);
      tidyDividers();
    } finally {
      mo.takeRecords();
      fitting = false;
    }
  }
  let raf = 0;
  const queue = () => { if (raf) return; raf = requestAnimationFrame(() => { raf = 0; fit(); }); };
  const mo = new MutationObserver(() => { if (!fitting) queue(); });
  mo.observe(bar, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['hidden'] });
  new ResizeObserver(queue).observe(bar);

  let started = false;
  function merge(on){
    if (on === merged && started) return;
    started = true;
    restoreMoved();
    setMore(false);
    if (on) {
      if (mb && mbHome.parentNode) { mbHome.parentNode.insertBefore(mb, mbHome.nextSibling); bar.classList.remove('stkc-ob-phone'); }
      copyTokens();
      bar.insertBefore(tb, bar.firstChild);
      bar.classList.add('stkc-onebar');
    } else {
      bar.classList.remove('stkc-onebar');
      if (home.parentNode) home.parentNode.insertBefore(tb, home.nextSibling);
      if (mb) { copyTokens(); barL.insertBefore(mb, barL.firstChild); bar.classList.add('stkc-ob-phone'); }
    }
    merged = on;
    fit();
  }

  const mode = () => (root.dataset && root.dataset.layout) || 'desktop';
  const apply = () => merge(mode() !== 'mobile');
  apply();
  fit();
  new MutationObserver(apply).observe(root, { attributes: true, attributeFilter: ['data-layout'] });
  window.addEventListener('resize', queue, { passive: true });
  try { document.fonts && document.fonts.ready.then(queue); } catch (e) {}

  const api = { fit, get merged(){ return merged; }, get moreCount(){ return moved.length; }, more: moreBtn, mobileBar: mb };
  window.__stkOneBar = api;
  return api;
}
