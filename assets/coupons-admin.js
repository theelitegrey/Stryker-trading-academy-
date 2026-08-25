// Stryker Trading Academy — Admin: Coupons (coupons-admin.html)
// Depends on: assets/auth.js, assets/progress.js (`db`), assets/admin-guard.js,
// assets/commerce.js

let ALL_COUPONS = [];
let ALL_PLANS_FOR_COUPON = [];
let EDITING_COUPON_CODE = null;

function loadPlansIntoCouponSelect(){
  return db.collection('plans').get().then((snap) => {
    ALL_PLANS_FOR_COUPON = [];
    snap.forEach((doc) => ALL_PLANS_FOR_COUPON.push(Object.assign({ id: doc.id }, doc.data())));
    const select = document.getElementById('coupon-plan');
    const currentOptions = select.querySelectorAll('option[data-plan-option]');
    currentOptions.forEach((o) => o.remove());
    ALL_PLANS_FOR_COUPON.forEach((plan) => {
      const opt = document.createElement('option');
      opt.value = plan.id;
      opt.textContent = plan.name;
      opt.setAttribute('data-plan-option', '1');
      select.appendChild(opt);
    });
  });
}

function planNameById(planId){
  const plan = ALL_PLANS_FOR_COUPON.find(p => p.id === planId);
  return plan ? plan.name : (planId === 'all' ? 'Any plan' : planId);
}

function renderCouponRow(coupon){
  const expired = isCouponExpired(coupon);
  const exhausted = isCouponExhausted(coupon);
  const statusLabel = !coupon.active ? 'Disabled' : expired ? 'Expired' : exhausted ? 'Fully redeemed' : 'Active';
  const statusClass = statusLabel === 'Active' ? 'active' : (statusLabel === 'Disabled' ? 'expired' : 'trial');

  const discountLabel = coupon.type === 'free' ? 'Free access'
    : coupon.type === 'percent' ? (coupon.value + '% off')
    : ('$' + coupon.value + ' off');

  const row = document.createElement('div');
  row.className = 'record-card';
  row.innerHTML =
    '<div style="flex:1 1 200px;">' +
      '<span class="cell-name" style="font-family:var(--font-mono);">' + coupon.code + '</span>' +
      '<div class="chapter-meta" style="margin-top:6px;"><span class="status-tag ' + statusClass + '">' + statusLabel + '</span><span>' + discountLabel + '</span><span>' + planNameById(coupon.appliesToPlan) + '</span></div>' +
    '</div>' +
    '<div class="record-stats">' +
      '<div class="record-stat"><span class="rs-label">Redeemed</span><span class="rs-val">' + (coupon.redemptionCount || 0) + (coupon.maxRedemptions ? ' / ' + coupon.maxRedemptions : '') + '</span></div>' +
      '<div class="record-stat"><span class="rs-label">Expires</span><span class="rs-val">' + (coupon.expiresAt || 'Never') + '</span></div>' +
    '</div>' +
    '<button class="btn btn-ghost btn-sm" data-edit-coupon="' + coupon.code + '">Edit</button>';

  row.querySelector('[data-edit-coupon]').addEventListener('click', () => openCouponEditor(coupon));
  return row;
}

function renderCouponList(){
  const list = document.getElementById('coupon-list');
  const countEl = document.getElementById('coupon-count');
  countEl.textContent = ALL_COUPONS.length + ' coupon' + (ALL_COUPONS.length === 1 ? '' : 's');

  if (!ALL_COUPONS.length) {
    list.innerHTML = '<p style="color:var(--ink-3); font-size:13.5px;">No coupons yet — click "+ New coupon" to create one.</p>';
    return;
  }
  list.innerHTML = '';
  ALL_COUPONS.forEach((c) => list.appendChild(renderCouponRow(c)));
}

function loadCoupons(){
  return db.collection('coupons').get().then((snap) => {
    ALL_COUPONS = [];
    snap.forEach((doc) => ALL_COUPONS.push(Object.assign({ code: doc.id }, doc.data())));
    ALL_COUPONS.sort((a, b) => (b.createdAtMillis || 0) - (a.createdAtMillis || 0));
    renderCouponList();
  });
}

function openCouponEditor(coupon){
  EDITING_COUPON_CODE = coupon ? coupon.code : null;
  document.getElementById('coupon-edit-heading').textContent = coupon ? ('Edit: ' + coupon.code) : 'New coupon';
  document.getElementById('coupon-code').value = coupon ? coupon.code : '';
  document.getElementById('coupon-code').disabled = !!coupon; // code is the doc ID — fixed once created
  document.getElementById('coupon-plan').value = coupon ? coupon.appliesToPlan : 'all';
  document.getElementById('coupon-type').value = coupon ? coupon.type : 'free';
  document.getElementById('coupon-value').value = coupon ? (coupon.value || '') : '';
  document.getElementById('coupon-max').value = coupon && coupon.maxRedemptions ? coupon.maxRedemptions : '';
  document.getElementById('coupon-expires').value = coupon && coupon.expiresAt ? coupon.expiresAt : '';
  document.getElementById('coupon-active').checked = coupon ? coupon.active !== false : true;
  document.getElementById('delete-coupon-btn').style.display = coupon ? 'inline-flex' : 'none';
  document.getElementById('coupon-edit-panel').style.display = 'block';
  document.getElementById('coupon-edit-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function closeCouponEditor(){
  document.getElementById('coupon-edit-panel').style.display = 'none';
  EDITING_COUPON_CODE = null;
}

document.addEventListener('DOMContentLoaded', () => {
  guardAdminPage(() => {
    loadPlansIntoCouponSelect()
      .then(() => loadCoupons())
      .catch((err) => {
        console.error('Stryker: failed to load coupons', err);
        document.getElementById('coupon-list').innerHTML =
          '<p style="color:var(--ink-3); font-size:13.5px;">Could not load coupons: ' + (err.message || err) + '</p>';
      });
  });

  document.getElementById('add-coupon-btn').addEventListener('click', () => openCouponEditor(null));
  document.getElementById('cancel-coupon-btn').addEventListener('click', closeCouponEditor);

  document.getElementById('save-coupon-btn').addEventListener('click', () => {
    const errEl = document.getElementById('coupon-error');
    errEl.style.display = 'none';

    const code = normalizeCouponCode(document.getElementById('coupon-code').value);
    if (!code) { errEl.textContent = 'A coupon code is required.'; errEl.style.display = 'block'; return; }
    if (!/^[A-Z0-9_-]+$/.test(code)) { errEl.textContent = 'Use only letters, numbers, dashes, and underscores.'; errEl.style.display = 'block'; return; }

    const type = document.getElementById('coupon-type').value;
    const value = type === 'free' ? 0 : (parseFloat(document.getElementById('coupon-value').value) || 0);
    const maxRedemptions = document.getElementById('coupon-max').value ? parseInt(document.getElementById('coupon-max').value, 10) : null;
    const expiresAt = document.getElementById('coupon-expires').value || null;

    const data = {
      type,
      value,
      appliesToPlan: document.getElementById('coupon-plan').value,
      maxRedemptions,
      expiresAt,
      active: document.getElementById('coupon-active').checked,
      createdAtMillis: Date.now()
    };
    if (!EDITING_COUPON_CODE) data.redemptionCount = 0;

    const btn = document.getElementById('save-coupon-btn');
    btn.disabled = true;

    if (typeof logActivity === 'function') logActivity('commerce.coupon_saved', 'Saved coupon ' + code, { detail: 'coupon ' + code });
    db.collection('coupons').doc(code).set(data, { merge: true })
      .then(() => loadCoupons())
      .then(() => closeCouponEditor())
      .catch((err) => { errEl.textContent = err.message || 'Could not save coupon.'; errEl.style.display = 'block'; })
      .finally(() => { btn.disabled = false; });
  });

  document.getElementById('delete-coupon-btn').addEventListener('click', () => {
    if (!EDITING_COUPON_CODE) return;
    if (!confirm('Delete coupon ' + EDITING_COUPON_CODE + '? Students will no longer be able to redeem it.')) return;
    if (typeof logActivity === 'function') logActivity('commerce.coupon_deleted', 'Deleted coupon ' + EDITING_COUPON_CODE, { detail: 'coupon ' + EDITING_COUPON_CODE });
    db.collection('coupons').doc(EDITING_COUPON_CODE).delete()
      .then(() => loadCoupons())
      .then(() => closeCouponEditor())
      .catch((err) => showToast('error', 'Could not delete: ' + (err.message || err)));
  });
});
