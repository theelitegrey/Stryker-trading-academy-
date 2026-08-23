// Stryker Trading Academy — Admin: Billing & Plans (billing-admin.html)
// Depends on: assets/auth.js, assets/progress.js (`db`), assets/admin-guard.js
//
// Plans live in Firestore's `plans` collection. Reads are public (the
// homepage pricing section pulls from here too, via assets/plans-public.js)
// — writes are admin-only, enforced by security rules.

let EDITING_PLAN_ID = null;
let ALL_PLANS = [];

function renderPlanCard(plan){
  const el = document.createElement('div');
  el.className = 'price-card' + (plan.featured ? ' featured' : '');
  const featuresHtml = (plan.features || []).map(f =>
    '<li><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6L9 17l-5-5"/></svg>' + f + '</li>'
  ).join('');
  el.innerHTML =
    '<h3>' + (plan.name || 'Untitled plan') + '</h3>' +
    '<div class="price-amt">$' + (plan.price || '0') + '<span>/ ' + (plan.period || 'month') + '</span></div>' +
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
    renderPlansGrid();
  });
}

function openPlanEditor(plan){
  EDITING_PLAN_ID = plan ? plan.id : null;
  document.getElementById('plan-edit-heading').textContent = plan ? ('Edit: ' + plan.name) : 'New plan';
  document.getElementById('plan-name').value = plan ? (plan.name || '') : '';
  document.getElementById('plan-price').value = plan ? (plan.price || '') : '';
  document.getElementById('plan-period').value = plan ? (plan.period || '') : 'month';
  document.getElementById('plan-chapters').value = plan ? (plan.chapterAccess || '') : 'all';
  document.getElementById('plan-featured').checked = !!(plan && plan.featured);
  document.getElementById('plan-features').value = plan ? (plan.features || []).join('\n') : '';
  document.getElementById('delete-plan-btn').style.display = plan ? 'inline-flex' : 'none';
  document.getElementById('plan-edit-panel').style.display = 'block';
  document.getElementById('plan-edit-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function closePlanEditor(){
  document.getElementById('plan-edit-panel').style.display = 'none';
  EDITING_PLAN_ID = null;
}

document.addEventListener('DOMContentLoaded', () => {
  guardAdminPage(() => {
    loadPlans().catch((err) => {
      console.error('Stryker: failed to load plans', err);
      document.getElementById('plans-grid').innerHTML =
        '<p style="color:var(--ink-3); font-size:13.5px;">Could not load plans: ' + (err.message || err) + '</p>';
    });
  });

  document.getElementById('add-plan-btn').addEventListener('click', () => openPlanEditor(null));
  document.getElementById('cancel-plan-btn').addEventListener('click', closePlanEditor);

  document.getElementById('save-plan-btn').addEventListener('click', () => {
    const errEl = document.getElementById('plans-error');
    errEl.style.display = 'none';

    const name = document.getElementById('plan-name').value.trim();
    if (!name) { errEl.textContent = 'Plan name is required.'; errEl.style.display = 'block'; return; }

    const data = {
      name,
      price: document.getElementById('plan-price').value.trim() || '0',
      period: document.getElementById('plan-period').value.trim() || 'month',
      chapterAccess: document.getElementById('plan-chapters').value.trim() || 'all',
      featured: document.getElementById('plan-featured').checked,
      features: document.getElementById('plan-features').value.split('\n').map(f => f.trim()).filter(Boolean),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };

    const btn = document.getElementById('save-plan-btn');
    btn.disabled = true;

    const ref = EDITING_PLAN_ID ? db.collection('plans').doc(EDITING_PLAN_ID) : db.collection('plans').doc();
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
      .catch((err) => alert('Could not delete: ' + (err.message || err)));
  });
});
