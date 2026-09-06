// Stryker Trading Academy — Admin: Billing & Plans (billing-admin.html)
// Depends on: assets/auth.js, assets/progress.js (`db`), assets/admin-guard.js
//
// Plans live in Firestore's `plans` collection. Reads are public (the
// homepage pricing section pulls from here too, via assets/plans-public.js)
// — writes are admin-only, enforced by security rules.
//
// Prices here are the USD base. Indian visitors see them converted to ₹ at
// the rate set in the "International pricing" panel below (stored in
// settings/commerce.usdInr, read by plan-price.js and the payment function).
// This page always shows the base dollars, whatever the admin's timezone.

window.STRYKER_FORCE_CURRENCY = 'USD';

let EDITING_PLAN_ID = null;
let ALL_PLANS = [];

function renderPlanCard(plan){
  const el = document.createElement('div');
  el.className = 'price-card' + (plan.featured ? ' featured' : '') +
    ((typeof planSaleInfo === 'function' && planSaleInfo(plan).active) ? ' on-sale' : '');
  var ribbon = (typeof planSaleRibbonHtml === 'function') ? planSaleRibbonHtml(plan) : '';
  const featuresHtml = (plan.features || []).map(f =>
    '<li><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6L9 17l-5-5"/></svg>' + f + '</li>'
  ).join('');
  const color = plan.color || '#8b93a0';
  const rankBadge = '<span style="display:inline-block; margin-bottom:8px; padding:2px 8px; border-radius:999px; font-family:var(--font-mono); font-size:10.5px; font-weight:700; letter-spacing:0.04em; text-transform:uppercase; color:' + color + '; background:' + color + '1a; border:1px solid ' + color + '55;">' + (plan.name || 'role') + ' \u00b7 rank ' + (plan.rank ?? 0) + '</span>';
  el.innerHTML =
    rankBadge +
    ribbon + '<h3>' + (plan.name || 'Untitled plan') + '</h3>' +
    (typeof planPriceHtml === 'function'
      ? planPriceHtml(plan, 'lg')
      : '<div class="price-amt">$' + (plan.price || '0') + '<span>/ ' + (plan.period || 'month') + '</span></div>') +
    '<ul>' + featuresHtml + '</ul>' +
    '<div style="font-size:12px; color:var(--ink-3); margin:10px 0 16px; font-family:var(--font-mono);">Chapter access: ' + (plan.chapterAccess || 'all') + '</div>' +
    '<div style="display:flex; gap:8px;">' +
      '<button type="button" class="btn btn-ghost btn-sm edit-plan-btn" style="flex:1;">Edit</button>' +
    '</div>';
  el.querySelector('.edit-plan-btn').addEventListener('click', () => openPlanEditor(plan));
  return el;
}

function renderPlansGrid(){
  const grid = document.getElementById('plans-grid');
  grid.innerHTML = '';
  if (!ALL_PLANS.length) {
    grid.innerHTML = '<p style="color:var(--ink-3); font-size:13.5px;">No plans yet — click "+ Add plan" to create the first one.</p>';
    return;
  }
  ALL_PLANS.forEach((plan) => grid.appendChild(renderPlanCard(plan)));
}

function loadPlans(){
  return db.collection('plans').get().then((snap) => {
    ALL_PLANS = [];
    snap.forEach((doc) => ALL_PLANS.push(Object.assign({ id: doc.id }, doc.data())));
    // Same lowest→highest order the homepage shows, so this grid IS the
    // preview of what visitors see.
    ALL_PLANS.sort((a, b) =>
      ((a.rank ?? 0) - (b.rank ?? 0)) ||
      ((parseFloat(a.price) || 0) - (parseFloat(b.price) || 0)));
    renderPlansGrid();
  });
}

function openPlanEditor(plan){
  EDITING_PLAN_ID = plan ? plan.id : null;
  document.getElementById('plan-edit-heading').textContent = plan ? ('Edit: ' + plan.name) : 'New plan';
  document.getElementById('plan-name').value = plan ? (plan.name || '') : '';
  document.getElementById('plan-price').value = plan ? (plan.price || '') : '';
  document.getElementById('plan-period').value = plan ? (plan.period || '') : 'month';
  document.getElementById('plan-on-sale').checked = !!(plan && plan.onSale);
  document.getElementById('plan-sale-price').value = plan ? (plan.salePrice || '') : '';
  document.getElementById('plan-sale-label').value = plan ? (plan.saleLabel || '') : '';
  document.getElementById('plan-sale-ends').value = plan ? (plan.saleEndsAt || '') : '';
  updateSalePreview();
  document.getElementById('plan-chapters').value = plan ? (plan.chapterAccess || '') : 'all';
  document.getElementById('plan-rank').value = String(plan && plan.rank != null ? plan.rank : 0);
  document.getElementById('plan-color').value = (plan && plan.color) || '#00adb5';
  document.getElementById('plan-featured').checked = !!(plan && plan.featured);
  const ctaEl = document.getElementById('plan-cta');
  if (ctaEl) ctaEl.value = plan ? (plan.ctaLabel || '') : '';
  document.getElementById('plan-features').value = plan ? (plan.features || []).join('\n') : '';
  document.getElementById('delete-plan-btn').style.display = plan ? 'inline-flex' : 'none';
  document.getElementById('plan-edit-panel').style.display = 'block';
  document.getElementById('plan-edit-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
  updatePlanColorPreview();
}

// Live read-out of what the offer works out to, so a bad sale price (higher
// than the plan price, or a date already gone) is obvious before saving.
function updateSalePreview(){
  var out = document.getElementById('plan-sale-preview');
  if (!out) return;
  var on = document.getElementById('plan-on-sale').checked;
  if (!on) { out.textContent = ''; return; }
  var full = parseFloat(document.getElementById('plan-price').value) || 0;
  var sale = parseFloat(document.getElementById('plan-sale-price').value);
  var ends = document.getElementById('plan-sale-ends').value;
  if (!isFinite(sale) || sale < 0) { out.textContent = 'Enter a sale price to switch the offer on.'; out.style.color = 'var(--amber)'; return; }
  if (full <= 0 || sale >= full) { out.textContent = 'The sale price must be lower than the plan price ($' + full + ') — the offer will not show.'; out.style.color = 'var(--bear)'; return; }
  var pct = Math.round(((full - sale) / full) * 100);
  var endTxt = '';
  if (ends) {
    var d = new Date(ends); d.setHours(23,59,59,999);
    endTxt = d.getTime() < Date.now() ? ' — but that end date has passed, so it will not show'
                                      : ' — runs until ' + d.toLocaleDateString();
  }
  out.style.color = /passed/.test(endTxt) ? 'var(--bear)' : 'var(--gold)';
  out.textContent = 'Students pay $' + sale + ' instead of $' + full + ' — ' + pct + '% off, saving $' + (full - sale).toFixed(2) + endTxt;
}

function updatePlanColorPreview(){
  const color = document.getElementById('plan-color').value;
  const name = document.getElementById('plan-name').value.trim() || 'ROLE';
  const preview = document.getElementById('plan-color-preview');
  if (!preview) return;
  preview.innerHTML =
    '<span style="display:inline-block; padding:2px 8px; border-radius:999px; font-family:var(--font-mono); font-size:10.5px; font-weight:700; letter-spacing:0.04em; text-transform:uppercase; color:' + color + '; background:' + color + '1a; border:1px solid ' + color + '55;">' + name + '</span>';
}

function closePlanEditor(){
  document.getElementById('plan-edit-panel').style.display = 'none';
  EDITING_PLAN_ID = null;
}

// The USD→INR rate lives in settings/commerce.usdInr — world-readable (the
// homepage converts with it before anyone signs in), admin-writable. The
// payment function reads the same doc, so saving here changes what Indian
// buyers see AND what they're charged, together.
function loadFxRate(){
  const input = document.getElementById('usd-inr-rate');
  if (!input) return Promise.resolve();
  return db.collection('settings').doc('commerce').get().then((doc) => {
    const r = doc.exists ? parseFloat(doc.data().usdInr) : NaN;
    input.value = (isFinite(r) && r > 0) ? r : 88;
    updateFxPreview();
  }).catch(() => { input.value = 88; updateFxPreview(); });
}

function updateFxPreview(){
  const out = document.getElementById('fx-preview');
  const r = parseFloat(document.getElementById('usd-inr-rate').value);
  if (!out) return;
  out.textContent = (isFinite(r) && r > 0)
    ? 'A $49 plan shows as ₹' + Math.round(49 * r).toLocaleString('en-IN') + ' in India.'
    : '';
}

function saveFxRate(){
  const errEl = document.getElementById('plans-error');
  const r = parseFloat(document.getElementById('usd-inr-rate').value);
  if (!isFinite(r) || r <= 0) {
    errEl.textContent = 'Enter a valid rate — how many rupees one dollar is worth.';
    errEl.style.display = 'block';
    return;
  }
  const btn = document.getElementById('save-fx-btn');
  btn.disabled = true;
  if (typeof logActivity === 'function') logActivity('commerce.fx_saved', 'Set USD→INR rate to ' + r, { detail: 'usdInr ' + r });
  db.collection('settings').doc('commerce').set({
    usdInr: r,
    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
  }, { merge: true })
    .then(() => showToast('success', 'Rate saved — Indian visitors now see ₹ prices at ' + r + ' per dollar.'))
    .catch((err) => { errEl.textContent = err.message || 'Could not save the rate.'; errEl.style.display = 'block'; })
    .finally(() => { btn.disabled = false; });
}

document.addEventListener('DOMContentLoaded', () => {
  guardAdminPage(() => {
    loadFxRate();
    loadPlans().catch((err) => {
      console.error('Stryker: failed to load plans', err);
      document.getElementById('plans-grid').innerHTML =
        '<p style="color:var(--ink-3); font-size:13.5px;">Could not load plans: ' + (err.message || err) + '</p>';
    });
  });

  const fxBtn = document.getElementById('save-fx-btn');
  if (fxBtn) fxBtn.addEventListener('click', saveFxRate);
  const fxInput = document.getElementById('usd-inr-rate');
  if (fxInput) fxInput.addEventListener('input', updateFxPreview);

  document.getElementById('add-plan-btn').addEventListener('click', () => openPlanEditor(null));
  document.getElementById('cancel-plan-btn').addEventListener('click', closePlanEditor);
  ['plan-on-sale','plan-sale-price','plan-sale-ends','plan-price'].forEach(function (id){
    var el = document.getElementById(id);
    if (el) el.addEventListener(el.type === 'checkbox' ? 'change' : 'input', updateSalePreview);
  });
  document.getElementById('plan-color').addEventListener('input', updatePlanColorPreview);
  document.getElementById('plan-name').addEventListener('input', updatePlanColorPreview);

  document.getElementById('save-plan-btn').addEventListener('click', () => {
    const errEl = document.getElementById('plans-error');
    errEl.style.display = 'none';

    const name = document.getElementById('plan-name').value.trim();
    if (!name) { errEl.textContent = 'Plan name is required.'; errEl.style.display = 'block'; return; }

    const data = {
      name,
      price: document.getElementById('plan-price').value.trim() || '0',
      period: document.getElementById('plan-period').value.trim() || 'month',
      onSale: document.getElementById('plan-on-sale').checked,
      salePrice: document.getElementById('plan-sale-price').value.trim(),
      saleLabel: document.getElementById('plan-sale-label').value.trim(),
      saleEndsAt: document.getElementById('plan-sale-ends').value || '',
      chapterAccess: document.getElementById('plan-chapters').value.trim() || 'all',
      rank: parseInt(document.getElementById('plan-rank').value, 10) || 0,
      color: document.getElementById('plan-color').value || '#00adb5',
      featured: document.getElementById('plan-featured').checked,
      ctaLabel: (document.getElementById('plan-cta') ? document.getElementById('plan-cta').value.trim() : ''),
      features: document.getElementById('plan-features').value.split('\n').map(f => f.trim()).filter(Boolean),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };

    const btn = document.getElementById('save-plan-btn');
    btn.disabled = true;

    const ref = EDITING_PLAN_ID ? db.collection('plans').doc(EDITING_PLAN_ID) : db.collection('plans').doc();
    if (typeof logActivity === 'function') logActivity('commerce.plan_saved', 'Saved plan ' + (data.name || ref.id), { detail: 'plan ' + ref.id });
    ref.set(data, { merge: true })
      .then(() => loadPlans())
      .then(() => { closePlanEditor(); })
      .catch((err) => { errEl.textContent = err.message || 'Could not save plan.'; errEl.style.display = 'block'; })
      .finally(() => { btn.disabled = false; });
  });

  document.getElementById('delete-plan-btn').addEventListener('click', () => {
    if (!EDITING_PLAN_ID) return;
    if (!confirm('Delete this plan? This removes it from the homepage immediately.')) return;
    db.collection('plans').doc(EDITING_PLAN_ID).delete()
      .then(() => loadPlans())
      .then(() => closePlanEditor())
      .catch((err) => showToast('error', 'Could not delete: ' + (err.message || err)));
  });
});
