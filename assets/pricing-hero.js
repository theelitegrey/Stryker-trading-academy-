// Stryker Trading Academy: homepage pricing section, "Hero Pro" layout (index.html #pricing)
// Depends on: assets/progress.js (`db`), assets/plan-price.js (strykerLoadPlans,
//             strykerFxReady, planSaleInfo, planMoneyDisplay, planDisplayName,
//             planIsArchived, planEscape, strykerCurrencyNoteHtml),
//             assets/trial.js (strykerTrialDecorate; no-op while
//             settings/commerce.trialEnabled is false).
//
// Renders into #pricing-root:
//   - a wide Pro spotlight (price, yearly line, CTA, six feature tiles)
//   - a slim "Not ready? Start free" strip
//   - a quiet "Compare Free and Pro" toggle that expands the full comparison
//     table (built on first open), with a Free/Pro tab switch on phones
//   - a three-question FAQ
// Every price comes from the live plans and the live usdInr rate (the same
// Math.round(usd x rate) checkout charges), so nothing here hard-codes money.
// The comparison-row wording mirrors assets/plan-limits.js and the plan
// feature lists; keep them in step if the Free limits change.
// Replaces assets/plans-public.js on the homepage (build 393). If plans fail to
// load, the static fallback cards inside #pricing-root are left in place.
(function () {
  'use strict';
  var esc = function (s) { return (typeof planEscape === 'function') ? planEscape(s) : String(s); };
  var reduce = function () { return !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches); };

  var TICK = '<svg class="pv-tick" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6L9 17l-5-5"/></svg>';
  var DASH = '<span class="pv-dash" role="img" aria-label="Not included">–</span>';

  function money(usd) { return planMoneyDisplay(usd); }
  function priceOf(plan) { return plan ? planSaleInfo(plan).price : 0; }
  function fullOf(plan) { var s = planSaleInfo(plan); return s.active ? s.full : 0; }

  function pick(all) {
    var byId = {};
    all.forEach(function (p) { byId[p.id] = p; });
    var visible = all.filter(function (p) { return !p.hidden && !planIsArchived(p); })
      .sort(function (a, b) { return ((+a.rank || 0) - (+b.rank || 0)) || (priceOf(a) - priceOf(b)); });
    var free = visible.find(function (p) { return !priceOf(p); }) || null;
    var pro = visible.find(function (p) { return p.featured && priceOf(p) > 0; }) ||
      visible.filter(function (p) { return priceOf(p) > 0; }).pop() || null;
    var yearly = pro && pro.yearlyPlanId ? byId[pro.yearlyPlanId] : null;
    return { free: free, pro: pro, yearly: yearly };
  }

  // "save about 25%": yearly vs twelve monthly payments, from the live prices.
  function yearlySavingPct(pro, yearly) {
    if (!pro || !yearly) return 0;
    var m = priceOf(pro) * 12, y = priceOf(yearly);
    if (!(m > 0) || !(y > 0) || y >= m) return 0;
    return Math.round((1 - y / m) * 100);
  }
  function checkoutHref(plan) { return 'checkout.html?plan=' + encodeURIComponent(plan.id); }
  function ctaLabel(plan, fallback) { return esc((plan.ctaLabel || '').trim() || fallback); }
  function per(plan) { return (typeof stkPeriodKind === 'function' && stkPeriodKind(plan.period) === 'year') ? 'year' : 'month'; }
  function priceHtml(plan) {
    var f = fullOf(plan);
    return money(priceOf(plan)) + (f ? ' <s class="pv-was">' + money(f) + '</s>' : '');
  }

  // "chapters 1–10" from the Free plan's chapterAccess ("1-10"), so the strip
  // follows the plan record rather than a typed number.
  function freeChaptersText(free) {
    var m = String(free.chapterAccess || '').match(/^(\d+)\s*-\s*(\d+)$/);
    return m ? 'chapters ' + m[1] + '–' + m[2] : 'the first chapters';
  }

  // ---------------------------------------------------------------- comparison (B)
  var GROUPS = [
    ['Learn', [
      ['Curriculum chapters', '@free-ch', 'All 64'],
      ['Volume Profile and Prop Firm tracks', false, true],
      ['Progress dashboard, achievements, streak', true, true]]],
    ['GEX', [
      ['Symbols', 'SPX', 'Every symbol'],
      ['Expiry views', 'Same-day (0DTE)', 'Every expiry'],
      ['Futures conversion', false, true],
      ['Strike table', false, true]]],
    ['Journal', [
      ['New trades', '20 / month', 'Unlimited'],
      ['Manual entry', true, true],
      ['Import and broker sync', false, true],
      ['Analytics and AI coach', false, true]]],
    ['Backtesting', [
      ['Replay sessions', '3 / week', 'Unlimited']]],
    ['Market desk', [
      ['Global Monitor, economic calendar, pre-market brief', true, true],
      ['Smart Money Desk, charts, trading models', false, true],
      ['Private indicators', false, true]]],
    ['Community', [
      ['Read everything', true, true],
      ['Post and send direct messages', false, true]]]
  ];
  function cell(v, P) {
    if (v === true) return TICK;
    if (v === false) return DASH;
    if (v === '@free-ch') {
      var m = String(P.free.chapterAccess || '').match(/^(\d+)\s*-\s*(\d+)$/);
      v = m ? 'Chapters ' + m[1] + '–' + m[2] : 'Starter chapters';
    }
    return '<span class="pv-lim">' + esc(v) + '</span>';
  }
  function compareHtml(P) {
    var save = yearlySavingPct(P.pro, P.yearly);
    var rows = GROUPS.map(function (g) {
      return '<div class="pv-grp" role="rowgroup"><div class="pv-grp-h" role="row"><span role="rowheader">' + esc(g[0]) + '</span><span class="pv-c-free" aria-hidden="true"></span><span class="pv-c-pro" aria-hidden="true"></span></div>' +
        g[1].map(function (r) {
          return '<div class="pv-row" role="row"><span class="pv-feat" role="rowheader">' + esc(r[0]) + '</span>' +
            '<span class="pv-c pv-c-free" role="cell">' + cell(r[1], P) + '</span>' +
            '<span class="pv-c pv-c-pro" role="cell">' + cell(r[2], P) + '</span></div>';
        }).join('') + '</div>';
    }).join('');
    return '<div class="pv-tabs" role="tablist" aria-label="Show plan">' +
        '<button type="button" role="tab" aria-selected="false" data-col="free">' + esc(planDisplayName(P.free)) + '</button>' +
        '<button type="button" role="tab" aria-selected="true" data-col="pro">' + esc(planDisplayName(P.pro)) + '</button>' +
      '</div>' +
      '<div class="pv-table" data-col="pro" role="table" aria-label="Free and Pro compared">' +
        '<div class="pv-thead" role="row">' +
          '<span class="pv-feat pv-th-label" role="columnheader">' +
            (P.yearly ? '<span class="pv-th-note">' + esc(planDisplayName(P.pro)) + ' yearly: ' + money(priceOf(P.yearly)) + (save ? ', save about ' + save + '%' : '') + '</span>' : '') +
          '</span>' +
          '<div class="pv-c pv-c-free pv-th" role="columnheader">' +
            '<b>' + esc(planDisplayName(P.free)) + '</b>' +
            '<div class="pv-th-price">' + money(0) + '<small>/ month</small></div>' +
            '<a href="signup" class="btn btn-ghost btn-sm">' + ctaLabel(P.free, 'Start free') + '</a>' +
          '</div>' +
          '<div class="pv-c pv-c-pro pv-th" role="columnheader">' +
            '<b>' + esc(planDisplayName(P.pro)) + '</b>' +
            '<div class="pv-th-price">' + priceHtml(P.pro) + '<small>/ ' + per(P.pro) + '</small></div>' +
            '<a href="' + checkoutHref(P.pro) + '" class="btn btn-primary btn-sm" data-pro-cta>' + ctaLabel(P.pro, 'Join Pro') + '</a>' +
          '</div>' +
        '</div>' +
        rows +
        (P.yearly ? '<div class="pv-tfoot"><a href="' + checkoutHref(P.yearly) + '" class="plan-yearly">or ' + money(priceOf(P.yearly)) + '/year →</a></div>' : '') +
      '</div>';
  }

  function wireCompare(root, P) {
    var btn = root.querySelector('.pv-compare-btn');
    var panel = root.querySelector('#pv-compare');
    var label = btn.querySelector('.pv-compare-label');
    var built = false, timer = 0;
    function build() {
      if (built) return;
      built = true;
      panel.querySelector('.pv-compare-inner').innerHTML = compareHtml(P);
      var tabs = panel.querySelector('.pv-tabs'), table = panel.querySelector('.pv-table');
      tabs.addEventListener('click', function (e) {
        var b = e.target.closest('button[data-col]');
        if (!b) return;
        tabs.querySelectorAll('button').forEach(function (x) { x.setAttribute('aria-selected', String(x === b)); });
        table.dataset.col = b.dataset.col;
      });
      var cta = panel.querySelector('[data-pro-cta]');
      if (cta && typeof strykerTrialDecorate === 'function') strykerTrialDecorate(cta, P.pro);
    }
    function settle() { panel.classList.remove('pv-anim'); panel.style.height = ''; }
    btn.addEventListener('click', function () {
      var open = btn.getAttribute('aria-expanded') !== 'true';
      clearTimeout(timer);
      btn.setAttribute('aria-expanded', String(open));
      label.textContent = open ? 'Hide comparison' : 'Compare ' + planDisplayName(P.free) + ' and ' + planDisplayName(P.pro);
      if (open) {
        build();
        panel.hidden = false;
        if (reduce()) { panel.classList.add('pv-open'); return; }
        var h = panel.scrollHeight;
        panel.style.height = '0px';
        panel.classList.add('pv-anim');
        void panel.offsetHeight;
        panel.classList.add('pv-open');
        panel.style.height = h + 'px';
        timer = setTimeout(settle, 460);
      } else {
        if (reduce()) { panel.classList.remove('pv-open'); panel.hidden = true; return; }
        panel.style.height = panel.scrollHeight + 'px';
        panel.classList.add('pv-anim');
        void panel.offsetHeight;
        panel.classList.remove('pv-open');
        panel.style.height = '0px';
        timer = setTimeout(function () { settle(); panel.hidden = true; }, 460);
      }
    });
  }

  // ---------------------------------------------------------------- hero (C)
  var ICONS = {
    learn: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z"/><path d="M4 20.5A2.5 2.5 0 0 1 6.5 18H20v3H6.5"/><path d="M9 7h7M9 10.5h5"/>',
    gex: '<path d="M4 20h16"/><path d="M7 17V9M11 17V5M15 17v-6M19 17v-9"/>',
    journal: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h3"/>',
    replay: '<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/><path d="M10 9l5 3-5 3z"/>',
    desk: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M7 12l3-3 3 2 4-4"/><path d="M9 20h6M12 16v4"/>',
    community: '<circle cx="9" cy="8" r="3"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><path d="M16 4.5a3 3 0 0 1 0 6M18 14.5c1.8.8 3 2.6 3 4.5"/>'
  };
  var ICON_ORDER = ['learn', 'gex', 'journal', 'replay', 'desk', 'community'];
  function icon(k) {
    return '<span class="pv-ico" aria-hidden="true"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + ICONS[k] + '</svg></span>';
  }
  function faq(q, a) {
    return '<details class="pv-q"><summary><span>' + esc(q) + '</span><i aria-hidden="true"></i></summary><div class="pv-a"><p>' + esc(a) + '</p></div></details>';
  }
  function render(root, P) {
    var save = yearlySavingPct(P.pro, P.yearly);
    var feats = (P.pro.features || []).slice(0, 6).map(function (f, i) {
      return '<li>' + icon(ICON_ORDER[i] || 'learn') + '<span>' + f + '</span></li>';
    }).join('');
    var freeName = planDisplayName(P.free), proName = planDisplayName(P.pro);
    root.innerHTML =
      '<div class="pv-hero">' +
        '<div class="pv-hero-l">' +
          '<span class="pv-pill">Most popular</span>' +
          '<h3>' + esc(proName) + '</h3>' +
          '<div class="pv-price pv-price-xl"><span class="pv-amt">' + priceHtml(P.pro) + '</span><span class="pv-per">/ ' + per(P.pro) + '</span></div>' +
          (P.yearly ? '<a class="plan-yearly" href="' + checkoutHref(P.yearly) + '">or ' + money(priceOf(P.yearly)) + '/year' + (save ? ', save about ' + save + '%' : '') + ' →</a>' : '') +
          '<a href="' + checkoutHref(P.pro) + '" class="btn btn-primary pv-cta-xl" data-pro-cta>' + ctaLabel(P.pro, 'Join Pro') + '</a>' +
          '<p class="pv-sub">Billed ' + (per(P.pro) === 'year' ? 'yearly' : 'monthly') + '. Cancel anytime.</p>' +
        '</div>' +
        '<ul class="pv-icons">' + feats + '</ul>' +
      '</div>' +
      '<div class="pv-strip">' +
        '<p><b>Not ready? Start free:</b> ' + esc(freeChaptersText(P.free)) + ', SPX GEX, 20 journal trades a month.</p>' +
        '<a href="signup" class="btn btn-ghost">' + ctaLabel(P.free, 'Start free') + '</a>' +
      '</div>' +
      '<div class="pv-compare-wrap">' +
        '<button type="button" class="pv-compare-btn" aria-expanded="false" aria-controls="pv-compare">' +
          '<span class="pv-compare-label">Compare ' + esc(freeName) + ' and ' + esc(proName) + '</span>' +
          '<svg class="pv-chev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>' +
        '</button>' +
      '</div>' +
      '<div class="pv-compare" id="pv-compare" hidden><div class="pv-compare-inner"></div></div>' +
      '<div class="pv-faq">' +
        faq('Can I cancel anytime?', 'Yes. Cancel from Billing in Settings. You keep ' + proName + ' until the end of the period you have already paid for, and you are not charged again.') +
        faq('Why can the rupee price change?', proName + ' is priced in US dollars. The rupee price is the dollar price at that day\'s exchange rate. Once you subscribe, your amount stays fixed.') +
        faq('What happens to my data on ' + freeName + '?', 'Your journal and progress stay saved. Nothing is deleted. You just see the ' + freeName + ' limits.') +
      '</div>';
    wireCompare(root, P);
  }

  document.addEventListener('DOMContentLoaded', function () {
    var root = document.getElementById('pricing-root');
    if (!root || typeof db === 'undefined') return;
    var fx = (typeof strykerFxReady === 'function') ? strykerFxReady() : Promise.resolve();
    Promise.all([strykerLoadPlans(), fx]).then(function (res) {
      var P = pick(res[0] || []);
      if (!P.free || !P.pro) return; // keep the static fallback cards
      root.classList.add('pv-live');
      render(root, P);
      if (typeof strykerCurrencyNoteHtml === 'function') root.insertAdjacentHTML('beforeend', strykerCurrencyNoteHtml());
      var cta = root.querySelector('.pv-hero [data-pro-cta]');
      if (cta && typeof strykerTrialDecorate === 'function') strykerTrialDecorate(cta, P.pro);
      if (reduce()) root.classList.add('pv-ready');
      else requestAnimationFrame(function () { root.classList.add('pv-ready'); });
    }).catch(function (e) {
      console.error('Stryker: pricing plans failed to load, showing static fallback', e);
    });
  });
})();
