// Stryker Trading Academy — Admin: Trading Indicators list (indicators-admin.html)
// Mirrors assets/models-admin.js, without the bulk "Update all" import since
// there's no seed array for indicators.

function escapeIndicatorsAdminText(s){
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function renderTvRequestsPanel(students){
  const panel = document.getElementById('tv-requests-panel');
  const list = document.getElementById('tv-requests-list');
  const countEl = document.getElementById('tv-requests-count');
  if (!panel || !list) return;

  const pending = students
    .filter((s) => s.tradingViewUsername && !s.tradingViewAccessGranted)
    .sort((a, b) => {
      const aTime = (a.tradingViewRequestedAt && a.tradingViewRequestedAt.toMillis) ? a.tradingViewRequestedAt.toMillis() : 0;
      const bTime = (b.tradingViewRequestedAt && b.tradingViewRequestedAt.toMillis) ? b.tradingViewRequestedAt.toMillis() : 0;
      return aTime - bTime; // oldest first
    });

  if (!pending.length) { panel.style.display = 'none'; return; }
  panel.style.display = 'block';
  countEl.textContent = pending.length + ' pending';

  list.innerHTML = '';
  pending.forEach((s) => {
    const requestedLabel = (s.tradingViewRequestedAt && s.tradingViewRequestedAt.toDate)
      ? s.tradingViewRequestedAt.toDate().toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
      : '';
    const row = document.createElement('div');
    row.className = 'record-card';
    row.innerHTML =
      '<div>' +
        '<span class="cell-name">' + escapeIndicatorsAdminText(s.tradingViewUsername) + '</span>' +
        '<span class="cell-sub">' + escapeIndicatorsAdminText(s.displayName || s.email || s.uid) + (requestedLabel ? ' · requested ' + requestedLabel : '') + '</span>' +
      '</div>' +
      '<button class="btn btn-primary btn-sm" data-grant-tv="' + s.uid + '">Mark as granted</button>';
    list.appendChild(row);
  });

  list.querySelectorAll('[data-grant-tv]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const uid = btn.dataset.grantTv;
      btn.disabled = true;
      if (typeof logActivity === 'function') logActivity('content.indicator_saved', 'Granted TradingView indicator access', { targetUid: uid });
      db.collection('students').doc(uid).set({ tradingViewAccessGranted: true }, { merge: true })
        .then(() => {
          if (typeof createNotification === 'function') {
            createNotification(uid, 'tv_access_granted', 'Your TradingView indicator access has been granted.', 'indicators.html');
          }
          if (typeof checkAndNotifyNewAchievementsFor === 'function') checkAndNotifyNewAchievementsFor(uid, true);
        })
        .then(loadTvRequests)
        .catch((err) => {
          showToast('error', 'Could not update: ' + (err.message || err));
          btn.disabled = false;
        });
    });
  });
}

function loadTvRequests(){
  return db.collection('students').get().then((snap) => {
    const students = [];
    snap.forEach((doc) => students.push(Object.assign({ uid: doc.id }, doc.data())));
    renderTvRequestsPanel(students);
  }).catch((err) => console.error('Stryker: failed to load TradingView requests', err));
}

function renderIndicatorList(){
  const container = document.getElementById('indicator-list');
  const countEl = document.getElementById('indicator-count');
  if (!container) return;

  if (countEl) countEl.textContent = INDICATORS.length + ' indicator' + (INDICATORS.length === 1 ? '' : 's');

  if (!INDICATORS.length) {
    container.innerHTML = '<p style="color:var(--ink-3); font-size:13.5px;">No trading indicators yet — the public page shows "Coming soon" until you add the first one. Click "+ Add new indicator" to get started.</p>';
    return;
  }

  container.innerHTML = '';
  const sorted = INDICATORS.slice().sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  sorted.forEach((ind) => {
    const card = document.createElement('div');
    card.className = 'record-card';
    card.innerHTML =
      '<div style="flex:1 1 260px;">' +
        '<span class="cell-name">' + (ind.name || 'Untitled indicator') + '</span>' +
        (ind.summary ? '<p style="font-size:12.5px; color:var(--ink-3); margin-top:6px; max-width:520px;">' + ind.summary + '</p>' : '') +
      '</div>' +
      '<div style="display:flex; gap:8px;">' +
        '<a href="indicator.html?id=' + encodeURIComponent(ind.id) + '" class="btn btn-ghost btn-sm" target="_blank">View</a>' +
        '<a href="indicator-editor.html?id=' + encodeURIComponent(ind.id) + '" class="btn btn-primary btn-sm">Edit</a>' +
      '</div>';
    container.appendChild(card);
  });
}

document.addEventListener('DOMContentLoaded', () => {
  guardAdminPage(() => {
    loadIndicators()
      .then(() => renderIndicatorList())
      .catch((err) => {
        console.error('Stryker: failed to load trading indicators admin page', err);
        document.getElementById('indicator-list').innerHTML =
          '<p style="color:var(--ink-3); font-size:13.5px;">Could not load: ' + (err.message || err) + '</p>';
      });
    loadTvRequests();
  });
});

// ---------------------------------------------------------------------------
// Showcase management — the indicator cards on the public Trading Indicators
// page. Stored in showcaseIndicators/{id}; the public page falls back to the
// bundled SHOWCASE_SEED when the collection is empty, and this panel seeds
// the collection from that same array the first time it is used, so editing
// always works on real documents.
// ---------------------------------------------------------------------------

var SHOWCASE_ITEMS = [];
var SHOWCASE_EDITING = null;   // id being edited, or '' for a new card

function scSlug(name){
  return String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || ('ind-' + Date.now());
}

function scSeedIfEmpty(){
  return db.collection('showcaseIndicators').get().then((snap) => {
    if (!snap.empty) {
      const items = [];
      snap.forEach((d) => items.push(d.data()));
      items.sort((a, b) => (a.order || 0) - (b.order || 0));
      return items;
    }
    if (typeof SHOWCASE_SEED === 'undefined' || !SHOWCASE_SEED.length) return [];
    const batch = db.batch();
    SHOWCASE_SEED.forEach((it) => batch.set(db.collection('showcaseIndicators').doc(it.id), it));
    return batch.commit().then(() => SHOWCASE_SEED.slice());
  });
}

function renderShowcaseAdmin(){
  const list = document.getElementById('showcase-admin-list');
  if (!list) return;
  if (!SHOWCASE_ITEMS.length) {
    list.innerHTML = '<p style="color:var(--ink-3); font-size:13px;">No showcase cards yet — add one.</p>';
    return;
  }
  list.innerHTML = '';
  SHOWCASE_ITEMS.forEach((it) => {
    const live = it.status === 'live';
    const row = document.createElement('div');
    row.className = 'record-card';
    row.innerHTML =
      '<div style="display:flex; align-items:center; gap:12px; min-width:0;">' +
        (it.img ? '<img src="' + escapeIndicatorsAdminText(it.img) + '" alt="" style="width:58px; height:32px; object-fit:cover; border-radius:6px; border:1px solid var(--line); flex-shrink:0;">' : '') +
        '<div style="min-width:0;">' +
          '<span class="cell-name">' + escapeIndicatorsAdminText(it.name) + '</span>' +
          '<span class="cell-sub" style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; display:block;">' +
            (live && it.tvUrl ? escapeIndicatorsAdminText(it.tvUrl) : 'no link yet') + '</span>' +
        '</div>' +
      '</div>' +
      '<div style="display:flex; gap:7px; align-items:center; flex-shrink:0; flex-wrap:wrap; justify-content:flex-end;">' +
        '<span class="ind-dev' + (live ? ' ind-live' : '') + '"><i></i>' + (live ? 'LIVE' : 'IN DEVELOPMENT') + '</span>' +
        '<button class="btn btn-ghost btn-sm" data-sc-act="toggle" data-sc-id="' + escapeIndicatorsAdminText(it.id) + '">' + (live ? 'Mark in development' : 'Mark live') + '</button>' +
        '<button class="btn btn-ghost btn-sm" data-sc-act="edit" data-sc-id="' + escapeIndicatorsAdminText(it.id) + '">Edit</button>' +
        '<button class="btn btn-ghost btn-sm" data-sc-act="remove" data-sc-id="' + escapeIndicatorsAdminText(it.id) + '" style="color:var(--bear);">Remove</button>' +
      '</div>';
    list.appendChild(row);
  });

  list.querySelectorAll('[data-sc-act]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const it = SHOWCASE_ITEMS.find((x) => x.id === btn.dataset.scId);
      if (!it) return;
      if (btn.dataset.scAct === 'edit') openShowcaseEditor(it);
      if (btn.dataset.scAct === 'toggle') {
        const next = it.status === 'live' ? 'dev' : 'live';
        if (next === 'live' && !/^https?:\/\//i.test(it.tvUrl || '')) {
          showToast('error', 'Add its TradingView link first (Edit) — a LIVE card needs somewhere to send people.');
          return;
        }
        btn.disabled = true;
        db.collection('showcaseIndicators').doc(it.id).set({ status: next }, { merge: true })
          .then(() => { it.status = next; renderShowcaseAdmin(); showToast('success', it.name + (next === 'live' ? ' is now LIVE on the site.' : ' is marked in development.')); })
          .catch((err) => { btn.disabled = false; showToast('error', 'Could not update: ' + (err.message || err)); });
      }
      if (btn.dataset.scAct === 'remove') {
        if (!confirm('Remove "' + it.name + '" from the public showcase? This cannot be undone.')) return;
        db.collection('showcaseIndicators').doc(it.id).delete()
          .then(() => { SHOWCASE_ITEMS = SHOWCASE_ITEMS.filter((x) => x.id !== it.id); renderShowcaseAdmin(); showToast('success', it.name + ' removed from the showcase.'); })
          .catch((err) => showToast('error', 'Could not remove: ' + (err.message || err)));
      }
    });
  });
}

function openShowcaseEditor(it){
  SHOWCASE_EDITING = it ? it.id : '';
  document.getElementById('sc-edit-heading').textContent = it ? ('Edit: ' + it.name) : 'Add an indicator';
  document.getElementById('sc-f-name').value = it ? (it.name || '') : '';
  document.getElementById('sc-f-tag').value = it ? (it.tag || '') : '';
  document.getElementById('sc-f-body').value = it ? (it.body || '') : '';
  document.getElementById('sc-f-chips').value = it ? (it.chips || []).join(', ') : '';
  document.getElementById('sc-f-url').value = it ? (it.tvUrl || '') : '';
  document.getElementById('sc-f-status').value = it && it.status === 'live' ? 'live' : 'dev';
  document.getElementById('sc-f-img').value = '';
  document.getElementById('sc-img-note').textContent = it && it.img
    ? 'Has a card image. Upload a new one to replace it, or leave empty to keep it.'
    : 'No card image yet — without one the card shows a small drawn chart.';
  const panel = document.getElementById('sc-edit-panel');
  panel.style.display = 'block';
  panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function saveShowcaseEditor(){
  const name = document.getElementById('sc-f-name').value.trim();
  if (!name) { showToast('error', 'The indicator needs a name.'); return; }
  const url = document.getElementById('sc-f-url').value.trim();
  const status = document.getElementById('sc-f-status').value;
  if (status === 'live' && !/^https?:\/\//i.test(url)) {
    showToast('error', 'A LIVE card needs a full TradingView link (https://…).');
    return;
  }

  const existing = SHOWCASE_ITEMS.find((x) => x.id === SHOWCASE_EDITING);
  const id = existing ? existing.id : scSlug(name);
  const maxOrder = SHOWCASE_ITEMS.reduce((m, x) => Math.max(m, x.order || 0), 0);

  const finish = (imgValue) => {
    const doc = {
      id: id,
      order: existing ? (existing.order || maxOrder + 1) : maxOrder + 1,
      name: name,
      tag: document.getElementById('sc-f-tag').value.trim(),
      body: document.getElementById('sc-f-body').value.trim(),
      chips: document.getElementById('sc-f-chips').value.split(',').map((c) => c.trim()).filter(Boolean).slice(0, 8),
      tvUrl: url,
      status: status,
      img: imgValue !== undefined ? imgValue : ((existing && existing.img) || null)
    };
    db.collection('showcaseIndicators').doc(id).set(doc).then(() => {
      if (existing) Object.assign(existing, doc);
      else SHOWCASE_ITEMS.push(doc);
      SHOWCASE_ITEMS.sort((a, b) => (a.order || 0) - (b.order || 0));
      document.getElementById('sc-edit-panel').style.display = 'none';
      renderShowcaseAdmin();
      showToast('success', name + ' saved — live on the indicators page now.');
      if (typeof logActivity === 'function') logActivity('content.indicator_saved', 'Saved showcase indicator ' + name);
    }).catch((err) => showToast('error', 'Could not save: ' + (err.message || err)));
  };

  const file = document.getElementById('sc-f-img').files[0];
  if (!file) { finish(undefined); return; }
  // Stored inline as a data URL, like bot avatars. Firestore documents cap at
  // ~1MB, so the image is downscaled to the card's real display size first.
  const img = new Image();
  img.onload = () => {
    const canvas = document.createElement('canvas');
    const scale = Math.min(1, 880 / img.width);
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
    if (dataUrl.length > 700000) { showToast('error', 'That image is too large even after resizing — try a simpler screenshot.'); return; }
    finish(dataUrl);
  };
  img.onerror = () => showToast('error', 'Could not read that image file.');
  img.src = URL.createObjectURL(file);
}

document.addEventListener('DOMContentLoaded', () => {
  if (!document.getElementById('showcase-admin-list')) return;
  if (typeof auth === 'undefined' || !auth) return;

  document.getElementById('sc-add-btn').addEventListener('click', () => openShowcaseEditor(null));
  document.getElementById('sc-save-btn').addEventListener('click', saveShowcaseEditor);
  document.getElementById('sc-cancel-btn').addEventListener('click', () => {
    document.getElementById('sc-edit-panel').style.display = 'none';
  });

  let done = false;
  auth.onAuthStateChanged((user) => {
    if (done || !user || typeof db === 'undefined' || !db) return;
    done = true;
    scSeedIfEmpty()
      .then((items) => { SHOWCASE_ITEMS = items; renderShowcaseAdmin(); })
      .catch((err) => {
        const list = document.getElementById('showcase-admin-list');
        if (list) list.innerHTML = '<p style="color:var(--bear); font-size:13px;">Could not load the showcase: ' + escapeIndicatorsAdminText(err.message || err) + '</p>';
      });
  });
});
