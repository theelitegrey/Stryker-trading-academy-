// Stryker Trading Academy: pricing section VARIATIONS (preview only, pricing-vars.html)
// Depends on: assets/progress.js (`db`), assets/plan-price.js (strykerLoadPlans,
//             strykerFxReady, planSaleInfo, planMoneyDisplay, planDisplayName,
//             planIsArchived, planEscape, strykerCurrencyNoteHtml),
//             assets/trial.js (strykerTrialDecorate; no-op while
//             settings/commerce.trialEnabled is false).
//
// Renders one of three layouts into #pv-root, picked by ?v=A|B|C:
//   A "Clean duo"        two centred cards, monthly/yearly toggle, saving computed
//   B "Comparison table" one panel, Free | Pro columns, grouped feature rows,
//                        sticky price/button header; phones get a Free/Pro tab switch
//   C "Hero Pro"         wide Pro spotlight, slim Free strip, short FAQ
// Every price comes from the live plans + the live usdInr rate, the same
// numbers the homepage cards and checkout use. Nothing here is hard-coded
// except the comparison-row wording (B), which mirrors plan-limits.js and the
// plan feature lists.
(function () {
  'use strict';
  var V = (new URLSearchParams(location.search).get('v') || 'A').toUpperCase();
  if (!/^[ABC]$/.test(V)) V = 'A';
  var esc = function (s) { return (typeof planEscape === 'function') ? planEscape(s) : String(s); };
  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  var TICK = '<svg class="pv-tick" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6L9 17l-5-5"/></svg>';
  var DASH = '<span class="pv-dash" aria-label="Not included">–</span>';

  function money(usd) { return planMoneyDisplay(usd); }
  function priceOf(plan) { return plan ? planSaleInfo(plan).price : 0; }

  function pick(all) {
    var byId = {};
    all.forEach(function (p) { byId[p.id] = p; });
    var visible = all.filter(function (p) { return !p.hidden && !planIsArchived(p); })
      .sort(function (a, b) { return ((+a.rank || 0) - (+b.rank || 0)) || (priceOf(a) - priceOf(b)); });
    var free = visible.find(function (p) { return !priceOf(p); }) || visible[0];
    var pro = visible.find(function (p) { return p.featured; }) || visible[visible.length - 1];
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
  function featuresList(plan) {
    return (plan.features || []).map(function (f) { return '<li>' + TICK + '<span>' + f + '</span></li>'; }).join('');
  }
  // Empty slot for the 7-day trial small print; trial.js fills it only when the
  // switch is on and the member is eligible (hidden today).
  var TRIAL_SLOT = '<div class="pv-trial-slot" data-trial-slot hidden></div>';

  // Fade/slide a price to a new value (instant under reduced motion).
  function swapText(el, html) {
    if (!el) return;
    if (reduce) { el.innerHTML = html; return; }
    el.classList.remove('pv-in');
    el.classList.add('pv-out');
    setTimeout(function () {
      el.innerHTML = html;
      el.classList.remove('pv-out');
      void el.offsetWidth;
      el.classList.add('pv-in');
    }, 170);
  }

  function billingToggle(save) {
    return '<div class="pv-toggle" role="radiogroup" aria-label="Billing period">' +
      '<button type="button" role="radio" aria-checked="true" data-period="month">Monthly</button>' +
      '<button type="button" role="radio" aria-checked="false" data-period="year">Yearly' +
      (save ? ' <span class="pv-save">save about ' + save + '%</span>' : '') + '</button>' +
      '<i class="pv-toggle-thumb" aria-hidden="true"></i></div>';
  }
  function wireToggle(root, onChange) {
    var t = root.querySelector('.pv-toggle');
    if (!t) return;
    var thumb = t.querySelector('.pv-toggle-thumb');
    function place() {
      var b = t.querySelector('button[aria-checked="true"]');
      if (!b || !thumb) return;
      thumb.style.width = b.offsetWidth + 'px';
      thumb.style.transform = 'translateX(' + (b.offsetLeft - 4) + 'px)';
    }
    place();
    window.addEventListener('resize', place);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(place);
    t.addEventListener('click', function (e) {
      var b = e.target.closest('button[data-period]');
      if (!b || b.getAttribute('aria-checked') === 'true') return;
      t.querySelectorAll('button').forEach(function (x) { x.setAttribute('aria-checked', String(x === b)); });
      t.dataset.on = b.dataset.period;
      place();
      onChange(b.dataset.period);
    });
  }

  // ---------------------------------------------------------------- A
  function renderA(root, P) {
    var save = yearlySavingPct(P.pro, P.yearly);
    root.innerHTML =
      (P.yearly ? billingToggle(save) : '') +
      '<div class="pv-duo">' +
        '<div class="pv-card">' +
          '<h3>' + esc(planDisplayName(P.free)) + '</h3>' +
          '<div class="pv-price"><span class="pv-amt" data-amt>' + money(priceOf(P.free)) + '</span><span class="pv-per" data-per>/ month</span></div>' +
          '<p class="pv-sub">No card required.</p>' +
          '<ul class="pv-feats">' + featuresList(P.free) + '</ul>' +
          '<a href="signup" class="btn btn-ghost btn-block">' + ctaLabel(P.free, 'Start free') + '</a>' +
        '</div>' +
        '<div class="pv-card pv-pro">' +
          '<span class="pv-pill">Most popular</span>' +
          '<h3>' + esc(planDisplayName(P.pro)) + '</h3>' +
          '<div class="pv-price"><span class="pv-amt" data-pro-amt>' + money(priceOf(P.pro)) + '</span><span class="pv-per" data-pro-per>/ month</span></div>' +
          '<p class="pv-sub" data-pro-sub>Billed monthly. Cancel anytime.</p>' +
          '<ul class="pv-feats">' + featuresList(P.pro) + '</ul>' +
          '<a href="' + checkoutHref(P.pro) + '" class="btn btn-primary btn-block" data-pro-cta>' + ctaLabel(P.pro, 'Join Pro') + '</a>' +
          TRIAL_SLOT +
        '</div>' +
      '</div>';
    wireToggle(root, function (period) {
      var y = period === 'year' && P.yearly;
      var plan = y ? P.yearly : P.pro;
      swapText(root.querySelector('[data-pro-amt]'), money(priceOf(plan)));
      swapText(root.querySelector('[data-pro-per]'), y ? '/ year' : '/ month');
      swapText(root.querySelector('[data-pro-sub]'), y
        ? 'Works out to ' + money(priceOf(plan) / 12) + ' a month, billed yearly.'
        : 'Billed monthly. Cancel anytime.');
      var cta = root.querySelector('[data-pro-cta]');
      cta.href = checkoutHref(plan);
      if (cta.getAttribute('data-trial') !== '1') cta.textContent = y ? 'Join Pro yearly' : ctaLabel(P.pro, 'Join Pro');
    });
  }

  // ---------------------------------------------------------------- B
  // Row wording mirrors assets/plan-limits.js (20 trades/month, 3 replays/week,
  // SPX 0DTE GEX) and the live Free/Pro feature lists.
  var GROUPS = [
    ['Learn', [
      ['Curriculum chapters', 'Chapters 1–10', 'All 64'],
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
  function cell(v) {
    if (v === true) return TICK;
    if (v === false) return DASH;
    return '<span class="pv-lim">' + esc(v) + '</span>';
  }
  function renderB(root, P) {
    var save = yearlySavingPct(P.pro, P.yearly);
    var rows = GROUPS.map(function (g) {
      return '<div class="pv-grp" role="rowgroup"><div class="pv-grp-h" role="row"><span role="rowheader">' + esc(g[0]) + '</span><span class="pv-c-free" aria-hidden="true"></span><span class="pv-c-pro" aria-hidden="true"></span></div>' +
        g[1].map(function (r) {
          return '<div class="pv-row" role="row"><span class="pv-feat" role="rowheader">' + esc(r[0]) + '</span>' +
            '<span class="pv-c pv-c-free" role="cell">' + cell(r[1]) + '</span>' +
            '<span class="pv-c pv-c-pro" role="cell">' + cell(r[2]) + '</span></div>';
        }).join('') + '</div>';
    }).join('');
    root.innerHTML =
      '<div class="pv-tabs" role="tablist" aria-label="Compare plans">' +
        '<button type="button" role="tab" aria-selected="false" data-col="free">' + esc(planDisplayName(P.free)) + '</button>' +
        '<button type="button" role="tab" aria-selected="true" data-col="pro">' + esc(planDisplayName(P.pro)) + '</button>' +
      '</div>' +
      '<div class="pv-table" data-col="pro" role="table" aria-label="Free and Pro compared">' +
        '<div class="pv-thead" role="row">' +
          '<span class="pv-feat pv-th-label" role="columnheader">' +
            (P.yearly ? '<span class="pv-th-note">Pro yearly: ' + money(priceOf(P.yearly)) + (save ? ', save about ' + save + '%' : '') + '</span>' : '') +
          '</span>' +
          '<div class="pv-c pv-c-free pv-th" role="columnheader">' +
            '<b>' + esc(planDisplayName(P.free)) + '</b>' +
            '<div class="pv-th-price">' + money(priceOf(P.free)) + '<small>/ month</small></div>' +
            '<a href="signup" class="btn btn-ghost btn-sm">' + ctaLabel(P.free, 'Start free') + '</a>' +
          '</div>' +
          '<div class="pv-c pv-c-pro pv-th" role="columnheader">' +
            '<b>' + esc(planDisplayName(P.pro)) + ' <span class="pv-pill pv-pill-inline">Most popular</span></b>' +
            '<div class="pv-th-price">' + money(priceOf(P.pro)) + '<small>/ month</small></div>' +
            '<a href="' + checkoutHref(P.pro) + '" class="btn btn-primary btn-sm" data-pro-cta>' + ctaLabel(P.pro, 'Join Pro') + '</a>' +
            TRIAL_SLOT +
          '</div>' +
        '</div>' +
        rows +
        (P.yearly ? '<div class="pv-tfoot"><a href="' + checkoutHref(P.yearly) + '" class="plan-yearly">or ' + money(priceOf(P.yearly)) + '/year →</a></div>' : '') +
      '</div>';
    var tabs = root.querySelector('.pv-tabs'), table = root.querySelector('.pv-table');
    tabs.addEventListener('click', function (e) {
      var b = e.target.closest('button[data-col]');
      if (!b) return;
      tabs.querySelectorAll('button').forEach(function (x) { x.setAttribute('aria-selected', String(x === b)); });
      table.dataset.col = b.dataset.col;
    });
  }

  // ---------------------------------------------------------------- C
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
  function renderC(root, P) {
    var save = yearlySavingPct(P.pro, P.yearly);
    var feats = (P.pro.features || []).slice(0, 6).map(function (f, i) {
      return '<li>' + icon(ICON_ORDER[i] || 'learn') + '<span>' + f + '</span></li>';
    }).join('');
    root.innerHTML =
      '<div class="pv-hero">' +
        '<div class="pv-hero-l">' +
          '<span class="pv-pill">Most popular</span>' +
          '<h3>' + esc(planDisplayName(P.pro)) + '</h3>' +
          '<div class="pv-price pv-price-xl"><span class="pv-amt">' + money(priceOf(P.pro)) + '</span><span class="pv-per">/ month</span></div>' +
          (P.yearly ? '<a class="plan-yearly" href="' + checkoutHref(P.yearly) + '">or ' + money(priceOf(P.yearly)) + '/year' + (save ? ', save about ' + save + '%' : '') + ' →</a>' : '') +
          '<a href="' + checkoutHref(P.pro) + '" class="btn btn-primary pv-cta-xl" data-pro-cta>' + ctaLabel(P.pro, 'Join Pro') + '</a>' +
          TRIAL_SLOT +
          '<p class="pv-sub">Billed monthly. Cancel anytime.</p>' +
        '</div>' +
        '<ul class="pv-icons">' + feats + '</ul>' +
      '</div>' +
      '<div class="pv-strip">' +
        '<p><b>Not ready? Start free:</b> chapters 1–10, SPX GEX, 20 journal trades a month.</p>' +
        '<a href="signup" class="btn btn-ghost">' + ctaLabel(P.free, 'Start free') + '</a>' +
      '</div>' +
      '<div class="pv-faq">' +
        faq('Can I cancel anytime?', 'Yes. Turn off renewal in Settings, under Billing. You keep Pro until the end of the period you have already paid for, and you are not charged again.') +
        faq('Why can the rupee price change?', 'Pro is priced in US dollars. Rupee prices are converted at a USD to INR rate that is refreshed daily, the same rate checkout uses, so the amount shown at checkout is the amount you pay.') +
        faq('What happens to my data on Free?', 'Nothing is deleted. Your journal trades, progress and settings stay, and you can still open and edit every trade. On Free, new journal entries are limited to 20 a month, and Pro tools such as import, broker sync and analytics lock until you upgrade.') +
      '</div>';
  }
  function faq(q, a) {
    return '<details class="pv-q"><summary><span>' + esc(q) + '</span><i aria-hidden="true"></i></summary><div class="pv-a"><p>' + esc(a) + '</p></div></details>';
  }

  // ---------------------------------------------------------------- boot
  function switcher() {
    var bar = document.createElement('nav');
    bar.className = 'pv-switch';
    bar.setAttribute('aria-label', 'Pricing variation');
    bar.innerHTML = '<span>Preview</span>' + ['A', 'B', 'C'].map(function (k) {
      var names = { A: 'Clean duo', B: 'Comparison table', C: 'Hero Pro' };
      return '<a href="?v=' + k + '#pricing"' + (k === V ? ' aria-current="true"' : '') + '>' + k + '<em> ' + names[k] + '</em></a>';
    }).join('');
    document.body.appendChild(bar);
  }

  document.addEventListener('DOMContentLoaded', function () {
    var root = document.getElementById('pv-root');
    if (!root) return;
    root.dataset.variant = V;
    switcher();
    if (typeof db === 'undefined') { root.innerHTML = '<p class="pv-err">Plans could not load.</p>'; return; }
    Promise.all([strykerLoadPlans(), strykerFxReady()]).then(function (res) {
      var P = pick(res[0] || []);
      if (!P.free || !P.pro) { root.innerHTML = '<p class="pv-err">Plans could not load.</p>'; return; }
      ({ A: renderA, B: renderB, C: renderC })[V](root, P);
      if (typeof strykerCurrencyNoteHtml === 'function') root.insertAdjacentHTML('beforeend', strykerCurrencyNoteHtml());
      var cta = root.querySelector('[data-pro-cta]');
      if (cta && typeof strykerTrialDecorate === 'function') strykerTrialDecorate(cta, P.pro);
      requestAnimationFrame(function () { root.classList.add('pv-ready'); });
    }).catch(function (e) {
      console.error('pricing-vars: plans failed', e);
      root.innerHTML = '<p class="pv-err">Plans could not load.</p>';
    });
  });
})();
