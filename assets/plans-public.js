// Stryker Trading Academy — public pricing section (index.html)
// Depends on: assets/progress.js (`db`)
// Reads Firestore's `plans` collection (public read). If it's empty — i.e.
// no admin has created plans yet — the original static cards already in
// the HTML are left untouched, so the homepage never shows a blank section.

function ctaForPlan(plan){
  if (/mentor/i.test(plan.name || '')) return { label: 'Apply for mentorship', cls: 'btn-ghost' };
  if (plan.featured) return { label: 'Join the desk', cls: 'btn-primary' };
  if (!parseFloat(plan.price)) return { label: 'Start free', cls: 'btn-ghost' };
  return { label: 'Get started', cls: 'btn-ghost' };
}

function renderPublicPlanCard(plan){
  const cta = ctaForPlan(plan);
  const featuresHtml = (plan.features || []).map(f =>
    '<li><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6L9 17l-5-5"/></svg>' + f + '</li>'
  ).join('');
  const el = document.createElement('div');
  el.className = 'price-card reveal in' + (plan.featured ? ' featured' : '');
  el.innerHTML =
    '<h3>' + (plan.name || 'Plan') + '</h3>' +
    '<div class="price-amt">$' + (plan.price || '0') + '<span>/ ' + (plan.period || 'month') + '</span></div>' +
    '<ul>' + featuresHtml + '</ul>' +
    '<a href="checkout.html?plan=' + encodeURIComponent(plan.id) + '" class="btn ' + cta.cls + ' btn-block">' + cta.label + '</a>';
  return el;
}

document.addEventListener('DOMContentLoaded', () => {
  if (typeof db === 'undefined') return;
  const grid = document.getElementById('pricing-grid');
  if (!grid) return;

  db.collection('plans').get().then((snap) => {
    if (snap.empty) return; // keep the static fallback cards already in the HTML
    const plans = [];
    snap.forEach((doc) => plans.push(Object.assign({ id: doc.id }, doc.data())));
    grid.innerHTML = '';
    plans.forEach((plan) => grid.appendChild(renderPublicPlanCard(plan)));
  }).catch((err) => {
    console.error('Stryker: failed to load live plans, showing static fallback', err);
  });
});
