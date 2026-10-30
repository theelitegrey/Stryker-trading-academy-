// TradeZoro shared pager (Owner 2026-10-30: pagination on long lists).
// One component, every list. Usage:
//   const pg = StrykerPager.create({ el: '#pager', onChange: render, sizes: [25,50,100], size: 25, label: 'users' });
//   pg.setTotal(list.length);  pg.reset();          // filters/search call reset() -> page 1
//   const rows = pg.slice(list);                     // rows for the current page
// Page + size live in the URL (?page=2&size=50) so back / refresh keeps them.
// Options: param ('page' prefix, for two pagers on one page), scrollTo (element to scroll to on page change), url:false to skip the URL.
(function(){
  var MQ = window.matchMedia ? window.matchMedia('(max-width:480px)') : { matches:false, addEventListener:function(){} };

  function readNum(name, dflt){
    try { var v = parseInt(new URLSearchParams(location.search).get(name), 10); return v > 0 ? v : dflt; } catch (e) { return dflt; }
  }
  function writeUrl(opts, page, size){
    if (opts.url === false || !window.history || !history.replaceState) return;
    try {
      var u = new URL(location.href), pn = opts.param || 'page', sn = opts.param ? opts.param + 'size' : 'size';
      if (page > 1) u.searchParams.set(pn, page); else u.searchParams.delete(pn);
      if (size !== opts.size) u.searchParams.set(sn, size); else u.searchParams.delete(sn);
      history.replaceState(history.state, '', u.pathname + u.search + u.hash);
    } catch (e) {}
  }
  // Page buttons to show: 1 … 4 5 6 … 12 (always first, last, current ±1).
  function pageList(cur, n){
    var out = [], i, set = {};
    [1, n, cur - 1, cur, cur + 1].forEach(function(p){ if (p >= 1 && p <= n) set[p] = 1; });
    if (cur <= 3) { set[2] = set[3] = 1; }
    if (cur >= n - 2) { set[n - 1] = set[n - 2] = 1; }
    var keys = Object.keys(set).map(Number).filter(function(p){ return p >= 1 && p <= n; }).sort(function(a, b){ return a - b; });
    for (i = 0; i < keys.length; i++) { if (i && keys[i] - keys[i - 1] > 1) out.push(0); out.push(keys[i]); }
    return out;
  }
  function esc(s){ return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'); }

  function create(opts){
    opts = opts || {};
    var el = typeof opts.el === 'string' ? document.querySelector(opts.el) : opts.el;
    // opts.after: an element (or selector) to insert the bar after, when the page has no container for it.
    if (!el && opts.after) {
      var anchor = typeof opts.after === 'string' ? document.querySelector(opts.after) : opts.after;
      if (!anchor) return null;
      el = document.createElement('div'); el.hidden = true;
      anchor.parentNode.insertBefore(el, anchor.nextSibling);
    }
    if (!el) return null;
    opts.sizes = opts.sizes || [25, 50, 100];
    opts.size = opts.size || opts.sizes[0];
    var pn = opts.param || 'page', sn = opts.param ? opts.param + 'size' : 'size';
    var size = readNum(sn, opts.size);
    if (opts.sizes.indexOf(size) === -1) size = opts.size;
    // opts.state: a caller-owned object, for views that rebuild their HTML (and so the pager element) on every render.
    var st = opts.state || {};
    if (!st.size) { st.page = readNum(pn, 1); st.size = size; }
    st.total = st.total || 0;
    var noun = opts.label || 'items';
    el.classList.add('szp');
    el.setAttribute('role', 'navigation');
    el.setAttribute('aria-label', 'Pagination, ' + noun);

    function pages(){ return Math.max(1, Math.ceil(st.total / st.size)); }
    function go(p, user){
      p = Math.max(1, Math.min(pages(), p));
      var changed = p !== st.page;
      st.page = p;
      writeUrl(opts, st.page, st.size);
      draw();
      if (changed && user) {
        var t = opts.scrollTo ? (typeof opts.scrollTo === 'string' ? document.querySelector(opts.scrollTo) : opts.scrollTo) : null;
        if (t && t.scrollIntoView) t.scrollIntoView({ block: 'start', behavior: window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
      }
      if (changed || user === 'force') api.onChange && api.onChange(st.page, st.size);
      else if (user) api.onChange && api.onChange(st.page, st.size);
    }
    function draw(){
      var n = pages(), cur = st.page;
      if (st.total <= opts.sizes[0]) { el.hidden = true; el.innerHTML = ''; return; }
      el.hidden = false;
      var from = (cur - 1) * st.size + 1, to = Math.min(st.total, cur * st.size);
      var h = '<div class="szp-info" aria-live="polite">Showing <b>' + from + '–' + to + '</b> of <b>' + st.total + '</b></div>';
      h += '<div class="szp-nav">';
      h += '<button type="button" class="szp-btn szp-step" data-p="' + (cur - 1) + '"' + (cur <= 1 ? ' disabled' : '') + ' aria-label="Previous page"><span aria-hidden="true">‹</span><span class="szp-steptxt"> Prev</span></button>';
      h += '<span class="szp-compact" aria-hidden="true">Page ' + cur + ' of ' + n + '</span>';
      h += '<span class="szp-nums">';
      pageList(cur, n).forEach(function(p){
        if (!p) h += '<span class="szp-gap" aria-hidden="true">…</span>';
        else h += '<button type="button" class="szp-btn szp-num' + (p === cur ? ' is-cur' : '') + '" data-p="' + p + '" aria-label="Page ' + p + '"' + (p === cur ? ' aria-current="page"' : '') + '>' + p + '</button>';
      });
      h += '</span>';
      h += '<button type="button" class="szp-btn szp-step" data-p="' + (cur + 1) + '"' + (cur >= n ? ' disabled' : '') + ' aria-label="Next page"><span class="szp-steptxt">Next </span><span aria-hidden="true">›</span></button>';
      h += '</div>';
      h += '<label class="szp-size"><span>Per page</span><select aria-label="Rows per page">' +
        opts.sizes.map(function(s){ return '<option value="' + s + '"' + (s === st.size ? ' selected' : '') + '>' + esc(s) + '</option>'; }).join('') + '</select></label>';
      el.innerHTML = h;
    }
    el.addEventListener('click', function(e){
      var b = e.target.closest('[data-p]');
      if (!b || b.disabled) return;
      go(parseInt(b.getAttribute('data-p'), 10), true);
      var again = el.querySelector('.szp-num.is-cur') || el.querySelector('.szp-compact');
      var keep = el.querySelector('[data-p="' + st.page + '"]');
      if (keep && keep.focus && document.activeElement === document.body) keep.focus();
    });
    el.addEventListener('change', function(e){
      var sel = e.target.closest('select');
      if (!sel) return;
      st.size = parseInt(sel.value, 10) || opts.size;
      st.page = 1;
      writeUrl(opts, st.page, st.size);
      draw();
      var f = el.querySelector('select'); if (f) f.focus();
      api.onChange && api.onChange(st.page, st.size);
    });
    var api = {
      onChange: opts.onChange,
      get page(){ return st.page; }, get size(){ return st.size; }, get total(){ return st.total; },
      // total changed (data loaded / filter applied). Clamps the page if it is now out of range.
      setTotal: function(n){ st.total = n | 0; if (st.page > pages()) st.page = pages(); writeUrl(opts, st.page, st.size); draw(); },
      reset: function(){ st.page = 1; writeUrl(opts, 1, st.size); draw(); },
      go: function(p){ go(p, true); },
      slice: function(arr){ return arr.slice((st.page - 1) * st.size, st.page * st.size); },
      redraw: draw
    };
    draw();
    return api;
  }
  window.StrykerPager = { create: create };
})();
