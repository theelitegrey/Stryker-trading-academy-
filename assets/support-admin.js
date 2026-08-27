// Stryker Trading Academy — Admin: Support inbox (support-admin.html)
// Contact-form submissions with handled tracking. Marking a message handled
// drops it out of the status=='new' count that both the dashboard's
// "Needs your attention" queue and the notification bell are built on, so
// clearing the inbox clears those too — no separate bookkeeping.
// Depends on: assets/admin-guard.js, assets/progress.js (db), assets/auth.js

let SUP_MESSAGES = [];
let SUP_FILTER = 'new';

function supEsc(s){
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function supWhen(ts){
  return ts && typeof ts.toDate === 'function'
    ? ts.toDate().toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
    : '—';
}

function supRenderStats(){
  const isNew = (m) => (m.status || 'new') === 'new';
  document.getElementById('sup-stat-new').textContent = SUP_MESSAGES.filter(isNew).length;
  document.getElementById('sup-stat-handled').textContent = SUP_MESSAGES.filter((m) => m.status === 'handled').length;
  document.getElementById('sup-stat-total').textContent = SUP_MESSAGES.length;
}

function supRenderList(){
  const wrap = document.getElementById('sup-list');
  const shown = SUP_MESSAGES.filter((m) => {
    const st = m.status || 'new';
    return SUP_FILTER === 'all' || st === SUP_FILTER;
  });
  if (!shown.length) {
    wrap.innerHTML = '<p style="color:var(--ink-3); font-size:13.5px;">' +
      (SUP_FILTER === 'new' ? 'Inbox zero — nothing waiting on you. 🎉' : 'Nothing here yet.') + '</p>';
    return;
  }
  wrap.innerHTML = '';
  shown.forEach((m) => {
    const st = m.status || 'new';
    const row = document.createElement('div');
    row.className = 'record-card sup-msg' + (st === 'handled' ? ' is-handled' : '');
    row.id = 'contact-' + m.id;
    row.innerHTML =
      '<div style="flex:1; min-width:0;">' +
        '<span class="cell-name">' + supEsc(m.name || 'Unknown') +
          (st === 'handled'
            ? ' <span class="status-tag active" style="margin-left:6px;">Handled</span>'
            : ' <span class="status-tag trial" style="margin-left:6px;">New</span>') + '</span>' +
        '<span class="cell-sub">' + supEsc(m.email || '—') + ' · ' + supWhen(m.createdAt) +
          (st === 'handled' && m.handledAt ? ' · handled ' + supWhen(m.handledAt) : '') + '</span>' +
        '<p style="font-size:13px; color:var(--ink-2); margin:8px 0 0; white-space:pre-wrap;">' + supEsc(m.message || '') + '</p>' +
      '</div>' +
      '<div style="display:flex; flex-direction:column; gap:8px; flex-shrink:0;">' +
        (m.email ? '<a class="btn btn-ghost btn-sm" href="mailto:' + supEsc(m.email) +
          '?subject=' + encodeURIComponent('Re: your message to Stryker Trading Academy') + '">Reply</a>' : '') +
        (st === 'handled'
          ? '<button type="button" class="btn btn-ghost btn-sm" data-sup-act="reopen" data-id="' + m.id + '">Reopen</button>'
          : '<button type="button" class="btn btn-primary btn-sm" data-sup-act="handle" data-id="' + m.id + '">✓ Mark handled</button>') +
      '</div>';
    wrap.appendChild(row);
  });

  // #contact-<id> deep link from a notification — rows only exist after render.
  if (location.hash.indexOf('#contact-') === 0) {
    const target = document.getElementById(location.hash.slice(1));
    if (target) {
      target.scrollIntoView({ block: 'center', behavior: 'smooth' });
      target.classList.add('record-card-flash');
      setTimeout(() => target.classList.remove('record-card-flash'), 2400);
    }
  }
}

function supSetStatus(id, status){
  const patch = { status: status };
  if (status === 'handled') {
    patch.handledAt = firebase.firestore.FieldValue.serverTimestamp();
    patch.handledByUid = (auth && auth.currentUser) ? auth.currentUser.uid : null;
  } else {
    patch.handledAt = null;
    patch.handledByUid = null;
  }
  return db.collection('contactMessages').doc(id).set(patch, { merge: true }).then(() => {
    const m = SUP_MESSAGES.find((x) => x.id === id);
    if (m) {
      m.status = status;
      if (status === 'handled') m.handledAt = { toDate: () => new Date() };
    }
    supRenderStats();
    supRenderList();
    if (typeof showToast === 'function') {
      showToast('success', status === 'handled' ? 'Marked handled.' : 'Reopened.');
    }
  }).catch((err) => {
    if (typeof showToast === 'function') showToast('error', 'Could not update: ' + (err.message || err));
  });
}

document.addEventListener('DOMContentLoaded', () => {
  guardAdminPage(() => {
    db.collection('contactMessages').orderBy('createdAt', 'desc').limit(200).get()
      .then((snap) => {
        SUP_MESSAGES = [];
        snap.forEach((doc) => {
          const m = doc.data();
          m.id = doc.id;
          SUP_MESSAGES.push(m);
        });
        // A deep-linked message may be handled already — show it either way.
        if (location.hash.indexOf('#contact-') === 0) SUP_FILTER = 'all';
        document.querySelectorAll('#sup-filter .term-cat').forEach((b) => {
          b.classList.toggle('is-on', b.dataset.f === SUP_FILTER);
        });
        supRenderStats();
        supRenderList();
      })
      .catch((err) => {
        document.getElementById('sup-list').innerHTML =
          '<p style="color:var(--ink-3); font-size:13.5px;">Could not load messages: ' + (err.message || err) + '</p>';
      });

    document.getElementById('sup-filter').addEventListener('click', (e) => {
      const btn = e.target.closest('.term-cat');
      if (!btn) return;
      SUP_FILTER = btn.dataset.f;
      document.querySelectorAll('#sup-filter .term-cat').forEach((b) => b.classList.toggle('is-on', b === btn));
      supRenderList();
    });

    document.getElementById('sup-list').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-sup-act]');
      if (!btn) return;
      btn.disabled = true;
      supSetStatus(btn.dataset.id, btn.dataset.supAct === 'handle' ? 'handled' : 'new');
    });
  });
});
