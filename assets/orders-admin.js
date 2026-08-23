// Stryker Trading Academy — Admin: Orders (orders-admin.html)
// Depends on: assets/auth.js, assets/progress.js (`db`), assets/admin-guard.js

let ALL_ORDERS = [];

function renderOrderRow(order){
  const createdDate = order.createdAt && order.createdAt.toDate ? order.createdAt.toDate() : null;
  const dateLabel = createdDate ? createdDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '—';

  const row = document.createElement('div');
  row.className = 'record-card';
  row.innerHTML =
    '<div class="cell-user" style="flex:1 1 220px;"><div class="cell-avatar"></div><div><span class="cell-name">' +
      (order.studentName || 'Unknown') + '</span><span class="cell-sub">' + (order.studentEmail || '—') + '</span></div></div>' +
    '<div class="record-stats">' +
      '<div class="record-stat"><span class="rs-label">Plan</span><span class="rs-val">' + (order.planName || '—') + '</span></div>' +
      '<div class="record-stat"><span class="rs-label">Coupon</span><span class="rs-val" style="font-family:var(--font-mono);">' + (order.couponCode || '—') + '</span></div>' +
      '<div class="record-stat"><span class="rs-label">Amount</span><span class="rs-val">$' + (order.finalAmount != null ? order.finalAmount : 0) + '</span></div>' +
      '<div class="record-stat"><span class="rs-label">Date</span><span class="rs-val">' + dateLabel + '</span></div>' +
    '</div>';
  return row;
}

function renderOrdersList(orders){
  const list = document.getElementById('orders-list');
  const countEl = document.getElementById('orders-count');
  countEl.textContent = orders.length + ' order' + (orders.length === 1 ? '' : 's');

  if (!orders.length) {
    list.innerHTML = '<p style="color:var(--ink-3); font-size:13.5px;">No orders yet.</p>';
    return;
  }
  list.innerHTML = '';
  orders.forEach((o) => list.appendChild(renderOrderRow(o)));
}

function loadOrders(){
  return db.collection('orders').orderBy('createdAt', 'desc').get().then((snap) => {
    ALL_ORDERS = [];
    snap.forEach((doc) => ALL_ORDERS.push(Object.assign({ id: doc.id }, doc.data())));
    renderOrdersList(ALL_ORDERS);
  });
}

document.addEventListener('DOMContentLoaded', () => {
  guardAdminPage(() => {
    loadOrders().catch((err) => {
      console.error('Stryker: failed to load orders', err);
      document.getElementById('orders-list').innerHTML =
        '<p style="color:var(--ink-3); font-size:13.5px;">Could not load orders: ' + (err.message || err) + '</p>';
      document.getElementById('orders-count').textContent = 'Error loading orders';
    });
  });

  document.getElementById('orders-search').addEventListener('input', (e) => {
    const q = e.target.value.trim().toLowerCase();
    if (!q) { renderOrdersList(ALL_ORDERS); return; }
    const filtered = ALL_ORDERS.filter(o =>
      (o.studentName || '').toLowerCase().includes(q) ||
      (o.studentEmail || '').toLowerCase().includes(q) ||
      (o.planName || '').toLowerCase().includes(q) ||
      (o.couponCode || '').toLowerCase().includes(q)
    );
    renderOrdersList(filtered);
  });
});
