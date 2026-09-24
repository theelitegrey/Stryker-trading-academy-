// Stryker Trading Academy — Admin: Commerce overview (commerce-admin.html)
// Depends on: assets/auth.js, assets/progress.js (`db`), assets/admin-guard.js

function renderRecentOrders(orders){
  const wrap = document.getElementById('commerce-recent-orders');
  const recent = orders.slice(0, 6);
  if (!recent.length) {
    wrap.innerHTML = '<p style="color:var(--ink-3); font-size:13.5px;">No orders yet.</p>';
    return;
  }
  wrap.innerHTML = '';
  recent.forEach((order) => {
    const createdDate = order.createdAt && order.createdAt.toDate ? order.createdAt.toDate() : null;
    const row = document.createElement('div');
    row.className = 'event-item';
    row.innerHTML =
      '<div class="event-body"><h4>' + stkEsc(order.studentName || 'Unknown') + ' — ' + stkEsc(order.planName || 'Plan') + '</h4>' +
      '<span>' + (order.provider === 'stripe' || order.gateway === 'stripe' ? 'Stripe · ' : (String(order.gateway || '').indexOf('razorpay') === 0 ? 'Razorpay · ' : '')) +
      (order.couponCode ? 'Coupon ' + stkEsc(order.couponCode) : 'No coupon') + (createdDate ? ' · ' + createdDate.toLocaleDateString() : '') + '</span></div>';
    wrap.appendChild(row);
  });
}

function renderTopCoupons(coupons){
  const wrap = document.getElementById('commerce-top-coupons');
  const sorted = coupons.slice().sort((a, b) => (b.redemptionCount || 0) - (a.redemptionCount || 0)).slice(0, 6);
  if (!sorted.length) {
    wrap.innerHTML = '<p style="color:var(--ink-3); font-size:13.5px;">No coupons yet.</p>';
    return;
  }
  wrap.innerHTML = '';
  sorted.forEach((c) => {
    const row = document.createElement('div');
    row.className = 'event-item';
    row.innerHTML =
      '<div class="event-body"><h4 style="font-family:var(--font-mono);">' + c.code + '</h4>' +
      '<span>' + (c.redemptionCount || 0) + ' redemption' + ((c.redemptionCount || 0) === 1 ? '' : 's') + (c.maxRedemptions ? ' of ' + c.maxRedemptions : '') + '</span></div>';
    wrap.appendChild(row);
  });
}

document.addEventListener('DOMContentLoaded', () => {
  guardAdminPage(() => {
    Promise.all([
      db.collection('orders').orderBy('createdAt', 'desc').get(),
      db.collection('coupons').get(),
      db.collection('plans').get()
    ]).then(([orderSnap, couponSnap, planSnap]) => {
      const orders = [];
      orderSnap.forEach((doc) => orders.push(doc.data()));
      const coupons = [];
      couponSnap.forEach((doc) => coupons.push(Object.assign({ code: doc.id }, doc.data())));
      const plans = [];
      planSnap.forEach((doc) => plans.push(Object.assign({ id: doc.id }, doc.data())));

      document.getElementById('cstat-total-orders').textContent = orders.length;

      const today = new Date().toISOString().slice(0, 10);
      const activeCoupons = coupons.filter(c => c.active !== false && (!c.expiresAt || c.expiresAt >= today) && (!c.maxRedemptions || (c.redemptionCount || 0) < c.maxRedemptions));
      document.getElementById('cstat-active-coupons').textContent = activeCoupons.length;

      const totalRedemptions = coupons.reduce((sum, c) => sum + (c.redemptionCount || 0), 0);
      document.getElementById('cstat-redemptions').textContent = totalRedemptions;

      const planCounts = {};
      orders.forEach((o) => { planCounts[o.planName] = (planCounts[o.planName] || 0) + 1; });
      let topPlan = '—', topCount = -1;
      Object.keys(planCounts).forEach((name) => { if (planCounts[name] > topCount) { topCount = planCounts[name]; topPlan = name; } });
      document.getElementById('cstat-top-plan').textContent = topPlan;

      renderRecentOrders(orders);
      renderTopCoupons(coupons);
    }).catch((err) => {
      console.error('Stryker: failed to load commerce overview', err);
      document.getElementById('commerce-recent-orders').innerHTML =
        '<p style="color:var(--ink-3); font-size:13.5px;">Could not load: ' + (err.message || err) + '</p>';
    });
  });
});

// Stripe connected yes/no (admins only; the server never returns the key).
function loadStripeStatus(){
  const el = document.getElementById('commerce-stripe-status');
  if (!el) return;
  let fns = null;
  try { fns = firebase.app().functions(); } catch (e) {}
  if (!fns) { el.textContent = 'unknown'; return; }
  fns.httpsCallable('stripeStatus')({}).then((res) => {
    const s = (res && res.data) || {};
    if (!s.configured) { el.textContent = 'No (no key on the server)'; el.style.color = 'var(--bear)'; return; }
    const ok = s.reachable && s.webhookSecretSet;
    el.textContent = (ok ? 'Yes' : 'Not fully') + ' · ' + (s.mode === 'live' ? 'LIVE mode' : 'TEST mode') +
      (s.reachable ? '' : ' · API unreachable (' + (s.error || '?') + ')') +
      (s.webhookSecretSet ? '' : ' · webhook secret missing');
    el.style.color = ok ? (s.mode === 'live' ? 'var(--bull)' : 'var(--amber, #e8b04b)') : 'var(--bear)';
    // The site switch (settings/commerce.stripeCheckout) decides whether visitors see Stripe.
    db.collection('settings').doc('commerce').get().then((d) => {
      const on = !!(d.exists && d.data().stripeCheckout === true);
      el.textContent += ' · checkout switch ' + (on ? 'ON (non-INR visitors pay with Stripe)' : 'OFF (everyone uses Razorpay)');
    }).catch(() => {});
  }).catch((err) => {
    const missing = err && (err.code === 'functions/not-found' || err.code === 'functions/unimplemented');
    el.textContent = missing ? 'No (not deployed yet)' : 'unknown';
  });
}
if (typeof firebase !== 'undefined') {
  try { firebase.auth().onAuthStateChanged((u) => { if (u) loadStripeStatus(); }); } catch (e) {}
}
