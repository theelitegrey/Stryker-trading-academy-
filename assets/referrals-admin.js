// Stryker Trading Academy — Admin: Referrals (referrals-admin.html)
// Depends on: assets/auth.js, assets/progress.js (`db`), assets/admin-guard.js,
// assets/referrals.js (loadReferralConfig, loadReferralLeaderboard)

function renderTopReferrers(list){
  const wrap = document.getElementById('ref-top-referrers-list');
  if (!list.length) {
    wrap.innerHTML = '<p style="color:var(--ink-3); font-size:13.5px;">No referral points awarded yet.</p>';
    return;
  }
  wrap.innerHTML = '';
  list.forEach((entry, i) => {
    const roleTag = (typeof roleTagHtml === 'function') ? roleTagHtml(entry.plan, { size: 'small' }) : '';
    const row = document.createElement('div');
    row.className = 'record-card';
    row.innerHTML =
      '<div style="display:flex; align-items:center; gap:12px; flex:1;">' +
        '<span style="font-family:var(--font-mono); font-size:13px; color:var(--ink-3); width:24px;">#' + (i + 1) + '</span>' +
        '<span class="cell-name">' + entry.name + roleTag + '</span>' +
      '</div>' +
      '<div style="font-family:var(--font-mono); font-size:13px; color:#f5c542; font-weight:700;">' + entry.points + ' pts</div>';
    wrap.appendChild(row);
  });
}

function renderRecentReferrals(docs){
  const wrap = document.getElementById('ref-recent-list');
  const countEl = document.getElementById('ref-recent-count');
  if (countEl) countEl.textContent = docs.length + ' shown';

  if (!docs.length) {
    wrap.innerHTML = '<p style="color:var(--ink-3); font-size:13.5px;">No referrals recorded yet.</p>';
    return;
  }
  wrap.innerHTML = '';
  docs.forEach((r) => {
    const when = r.createdAt && typeof r.createdAt.toDate === 'function'
      ? r.createdAt.toDate().toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
      : '—';
    const statusColor = r.status === 'converted' ? '#03c988' : '#8b93a0';
    const row = document.createElement('div');
    row.className = 'record-card';
    row.innerHTML =
      '<div style="flex:1;"><span class="cell-name">' + (r.referredName || r.referredEmail || 'Unknown') + '</span>' +
        '<div style="font-family:var(--font-mono); font-size:11.5px; color:var(--ink-3); margin-top:3px;">' + when + ' · code ' + (r.referrerCode || '—') + '</div></div>' +
      '<div style="text-align:right;">' +
        '<div style="font-family:var(--font-mono); font-size:13px; color:#f5c542; font-weight:700;">+' + (r.pointsAwarded || 0) + ' pts</div>' +
        '<div style="font-family:var(--font-mono); font-size:11px; color:' + statusColor + '; margin-top:3px; text-transform:capitalize;">' + (r.status || 'signed_up').replace('_', ' ') + '</div>' +
      '</div>';
    wrap.appendChild(row);
  });
}

function loadReferralStats(){
  return db.collection('referrals').get().then((snap) => {
    let total = 0, converted = 0;
    const docs = [];
    snap.forEach((doc) => {
      const d = doc.data();
      docs.push(d);
      total++;
      if (d.status === 'converted') converted++;
    });
    docs.sort((a, b) => {
      const ta = a.createdAt && a.createdAt.toMillis ? a.createdAt.toMillis() : 0;
      const tb = b.createdAt && b.createdAt.toMillis ? b.createdAt.toMillis() : 0;
      return tb - ta;
    });

    document.getElementById('refstat-total-invites').textContent = total;
    document.getElementById('refstat-total-conversions').textContent = converted;
    document.getElementById('refstat-conversion-rate').textContent = total ? Math.round((converted / total) * 100) + '%' : '—';
    renderRecentReferrals(docs.slice(0, 30));
  });
}

document.addEventListener('DOMContentLoaded', () => {
  guardAdminPage(() => {
    Promise.all([loadPlansForRoles(), loadReferralConfig()])
      .then(([, config]) => {
        document.getElementById('ref-points-signup').value = config.pointsPerSignup;
        document.getElementById('ref-points-conversion').value = config.pointsPerConversion;
        document.getElementById('ref-enabled-toggle').checked = !!config.enabled;
      });

    loadReferralStats().catch((err) => {
      console.error('Stryker: failed to load referral stats', err);
      document.getElementById('ref-admin-error').textContent = 'Could not load referral stats: ' + (err.message || err);
      document.getElementById('ref-admin-error').style.display = 'block';
    });

    loadReferralLeaderboard(10).then(renderTopReferrers);

    document.getElementById('save-ref-config-btn').addEventListener('click', () => {
      const errEl = document.getElementById('ref-admin-error');
      const okEl = document.getElementById('ref-admin-success');
      errEl.style.display = 'none';
      okEl.style.display = 'none';

      const data = {
        pointsPerSignup: parseInt(document.getElementById('ref-points-signup').value, 10) || 0,
        pointsPerConversion: parseInt(document.getElementById('ref-points-conversion').value, 10) || 0,
        enabled: document.getElementById('ref-enabled-toggle').checked
      };

      const btn = document.getElementById('save-ref-config-btn');
      btn.disabled = true;
      db.collection('settings').doc('referralConfig').set(data, { merge: true })
        .then(() => {
          okEl.textContent = 'Point values saved.';
          okEl.style.display = 'block';
        })
        .catch((err) => {
          errEl.textContent = err.message || 'Could not save point values.';
          errEl.style.display = 'block';
        })
        .finally(() => { btn.disabled = false; });
    });
  });
});
