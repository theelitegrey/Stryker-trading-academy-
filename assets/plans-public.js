// Stryker Trading Academy — public pricing section (index.html)
// Depends on: assets/progress.js (`db`)
// Reads Firestore's `plans` collection (public read). If it's empty — i.e.
// no admin has created plans yet — the original static cards already in
// the HTML are left untouched, so the homepage never shows a blank section.

function ctaForPlan(plan){
  const onSale = (typeof planSaleInfo === 'function') && planSaleInfo(plan).active;
  const cls = (plan.featured || onSale) ? 'btn-primary' : 'btn-ghost';
  // A CTA set in Billing & plans admin wins; the heuristics below only cover
  // plans that haven't set one.
  if (plan.ctaLabel && String(plan.ctaLabel).trim()) {
    const t = String(plan.ctaLabel).trim();
    return { label: (typeof planEscape === 'function') ? planEscape(t) : t, cls };
  }
  if (/mentor/i.test(plan.name || '')) return { label: 'Apply for mentorship', cls: 'btn-ghost' };
  if (onSale) return { label: 'Claim this price', cls: 'btn-primary' };
  if (plan.featured) return { label: 'Join the desk', cls: 'btn-primary' };
  if (!parseFloat(plan.price)) return { label: 'Start free', cls: 'btn-ghost' };
  return { label: 'Get started', cls: 'btn-ghost' };
}

// Cheapest tier first, priciest last — the order a pricing page reads in.
// Rank is the primary key (it's what the role system already means by
// "higher tier"); price breaks ties for plans that share a rank.
function sortPlansAscending(plans){
  return plans.sort((a, b) =>
    ((a.rank ?? 0) - (b.rank ?? 0)) ||
    ((parseFloat(a.price) || 0) - (parseFloat(b.price) || 0)));
}

// The WELCOME founding offer (first 50 join free) shows as a note on the plan
// card it applies to, with a live seats-left count read from the coupon doc.
// commerce.js isn't loaded on the homepage, so the validity checks are inlined
// here; a read denied by rules (e.g. for signed-out visitors) simply hides the
// note rather than breaking the pricing grid.
function loadFoundingOffer(){
  return db.collection('coupons').doc('WELCOME').get().then((doc) => {
    if (!doc.exists) return null;
    const c = Object.assign({ code: doc.id }, doc.data());
    if (c.active === false) return null;
    if (c.expiresAt && c.expiresAt < new Date().toISOString().slice(0, 10)) return null;
    if (c.maxRedemptions && (c.redemptionCount || 0) >= c.maxRedemptions) return null;
    return c;
  }).catch(() => null);
}

function offerAppliesToCard(offer, plan){
  if (!offer) return false;
  if (offer.appliesToPlan && offer.appliesToPlan !== 'all') return offer.appliesToPlan === plan.id;
  // an any-plan offer is advertised once, on the highest-profile card
  return !!plan.featured || /elite/i.test(plan.name || '');
}

function renderPublicPlanCard(plan, offer){
  const cta = ctaForPlan(plan);
  const featuresHtml = (plan.features || []).map(f =>
    '<li><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6L9 17l-5-5"/></svg>' + f + '</li>'
  ).join('');
  const sale = (typeof planSaleInfo === 'function') ? planSaleInfo(plan) : { active: false };
  const hasOffer = offerAppliesToCard(offer, plan);
  const checkoutHref = 'checkout.html?plan=' + encodeURIComponent(plan.id) +
    (hasOffer ? '&coupon=' + encodeURIComponent(offer.code) : '');
  const el = document.createElement('div');
  el.className = 'price-card reveal in' + (plan.featured ? ' featured' : '') + (sale.active ? ' on-sale' : '');
  el.innerHTML =
    (typeof planSaleRibbonHtml === 'function' ? planSaleRibbonHtml(plan) : '') +
    '<h3>' + stkEsc(plan.name || 'Plan') + '</h3>' +
    (typeof planPriceHtml === 'function'
      ? planPriceHtml(plan, 'lg')
      : '<div class="price-amt">$' + (plan.price || '0') + '<span>/ ' + (plan.period || 'month') + '</span></div>') +
    (hasOffer
      ? '<div class="founding-note">🎟 First 50 join <b>FREE</b> — code <b>' + offer.code + '</b><span class="fn-seats">Limited seats</span></div>'
      : '') +
    '<ul>' + featuresHtml + '</ul>' +
    '<a href="' + checkoutHref + '" class="btn ' + cta.cls + ' btn-block">' + (hasOffer ? 'Claim a free seat' : cta.label) + '</a>';
  return el;
}

document.addEventListener('DOMContentLoaded', () => {
  if (typeof db === 'undefined') return;
  const grid = document.getElementById('pricing-grid');
  if (!grid) return;

  // The USD→INR rate loads alongside the plans so Indian visitors' first
  // paint is already in rupees — no dollar flash, no re-render.
  const fxReady = (typeof strykerFxReady === 'function') ? strykerFxReady() : Promise.resolve();
  Promise.all([db.collection('plans').get(), loadFoundingOffer(), fxReady]).then(([snap, offer]) => {
    if (typeof strykerCurrencyNoteHtml === 'function') {
      grid.insertAdjacentHTML('afterend', strykerCurrencyNoteHtml());
    }
    if (snap.empty) return; // keep the static fallback cards already in the HTML
    const plans = [];
    snap.forEach((doc) => plans.push(Object.assign({ id: doc.id }, doc.data())));
    sortPlansAscending(plans);
    grid.innerHTML = '';
    plans.forEach((plan) => grid.appendChild(renderPublicPlanCard(plan, offer)));
    if (typeof startSaleCountdowns === 'function') startSaleCountdowns();
  }).catch((err) => {
    console.error('Stryker: failed to load live plans, showing static fallback', err);
  });
});
