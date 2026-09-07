// Stryker Trading Academy — Admin: Trading Indicators list (indicators-admin.html)
// Mirrors assets/models-admin.js, without the bulk "Update all" import since
// there's no seed array for indicators.

function escapeIndicatorsAdminText(s){
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ---------------------------------------------------------------------------
// TradingView auto-grant — settings + server calls.
// When enabled, "Mark as granted" / "Revoke" first perform the REAL grant or
// removal on TradingView through the admin-only callables in
// functions-src/tvAccess.js, and only record the result here if that worked.
// Disabled (or on any failure), everything behaves exactly as before: the
// admin grants manually on TradingView's Manage Access page.
// ---------------------------------------------------------------------------

let TV_CFG = { enabled: false, pineIds: [], duration: '1L' };

function tvCall(name, payload){
  let fns = null;
  try { fns = firebase.app().functions(); } catch (e) {}
  if (!fns) return Promise.reject(new Error('The functions SDK did not load on this page.'));
  return fns.httpsCallable(name)(payload).then((r) => r.data);
}

function renderTvConfigStatus(){
  const el = document.getElementById('tv-auto-status');
  if (el) el.textContent = TV_CFG.enabled
    ? 'ON · ' + TV_CFG.pineIds.length + ' script' + (TV_CFG.pineIds.length === 1 ? '' : 's') + ' · ' + TV_CFG.duration
    : 'off — grants are recorded only';
}

function loadTvConfig(){
  return db.collection('settings').doc('tradingview').get().then((doc) => {
    const d = doc.exists ? (doc.data() || {}) : {};
    TV_CFG = {
      enabled: !!d.enabled,
      pineIds: Array.isArray(d.pineIds) ? d.pineIds : [],
      duration: d.duration || '1L'
    };
    const en = document.getElementById('tv-auto-enabled');
    const ids = document.getElementById('tv-auto-pineids');
    const dur = document.getElementById('tv-auto-duration');
    if (en) en.checked = TV_CFG.enabled;
    if (ids) ids.value = TV_CFG.pineIds.join('\n');
    if (dur) dur.value = TV_CFG.duration;
    renderTvConfigStatus();
  }).catch((err) => console.error('Stryker: could not load TradingView settings', err));
}

function saveTvConfig(){
  const enabled = document.getElementById('tv-auto-enabled').checked;
  const pineIds = document.getElementById('tv-auto-pineids').value
    .split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);
  if (enabled && !pineIds.length) {
    showToast('error', 'Add at least one Pine ID before switching auto-grant on.');
    return;
  }
  const odd = pineIds.filter((id) => !/^PUB;/i.test(id));
  if (odd.length && !confirm(odd.length + ' of the Pine IDs do not start with "PUB;" — they usually do.\n\nSave anyway?')) return;

  const btn = document.getElementById('tv-auto-save');
  btn.disabled = true;
  const duration = document.getElementById('tv-auto-duration').value;
  if (typeof logActivity === 'function') logActivity('content.indicator_saved', 'Saved TradingView auto-grant settings');
  db.collection('settings').doc('tradingview').set({
    enabled, pineIds, duration,
    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
  }, { merge: true })
    .then(() => {
      TV_CFG = { enabled, pineIds, duration };
      renderTvConfigStatus();
      showToast('success', enabled
        ? 'Auto-grant is ON — "Mark as granted" now grants on TradingView itself.'
        : 'Auto-grant is off — grants are recorded on the site only.');
    })
    .catch((err) => showToast('error', 'Could not save: ' + (err.message || err)))
    .finally(() => { btn.disabled = false; });
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
      '<div style="display:flex; gap:7px;">' +
        '<button class="btn btn-ghost btn-sm" data-verify-tv="' + s.uid + '">Verify</button>' +
        '<button class="btn btn-primary btn-sm" data-grant-tv="' + s.uid + '">' +
          (TV_CFG.enabled ? 'Grant on TradingView' : 'Mark as granted') + '</button>' +
      '</div>';
    list.appendChild(row);
  });

  // Verify: does this TradingView username actually exist? Catches typos
  // before anyone burns time on TradingView's Manage Access page.
  list.querySelectorAll('[data-verify-tv]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const s = TV_STUDENTS.find((x) => x.uid === btn.dataset.verifyTv);
      if (!s) return;
      btn.disabled = true; btn.textContent = 'Checking…';
      tvCall('tvValidateUsername', { username: s.tradingViewUsername }).then((res) => {
        btn.textContent = res.valid ? '✓ Exists' : '✗ Not found';
        btn.style.color = res.valid ? 'var(--bull)' : 'var(--bear)';
        if (!res.valid) showToast('error', '"' + s.tradingViewUsername + '" is not a TradingView username — ask the student to re-check it.');
        else if (res.verifiedName && res.verifiedName !== s.tradingViewUsername) {
          showToast('success', 'Exists — TradingView spells it "' + res.verifiedName + '".');
        }
      }).catch((err) => {
        btn.disabled = false; btn.textContent = 'Verify';
        showToast('error', 'Could not check: ' + (err.message || err));
      });
    });
  });

  list.querySelectorAll('[data-grant-tv]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const uid = btn.dataset.grantTv;
      const s = TV_STUDENTS.find((x) => x.uid === uid);
      btn.disabled = true;

      // With auto-grant on, the REAL TradingView grant happens first — and a
      // failure records nothing, so the site never claims access that wasn't
      // given. With it off, this is the same record-keeping click as always.
      const tvFirst = (TV_CFG.enabled && s)
        ? (btn.textContent = 'Granting on TradingView…',
           tvCall('tvGrantAccess', { username: s.tradingViewUsername }).then((res) => {
             showToast('success', 'TradingView: ' + res.results.map((r) => r.action).join(', ') +
               ' for ' + res.username + ' (' + (res.duration === '1L' ? 'lifetime' : res.duration) + ').');
           }))
        : Promise.resolve();

      tvFirst.then(() => {
      if (typeof logActivity === 'function') logActivity('content.indicator_saved', 'Granted TradingView indicator access', { targetUid: uid });
      return db.collection('students').doc(uid).set({
        tradingViewAccessGranted: true,
        // Stamped so the approved list below can sort by when access was
        // actually given; rows granted before this existed fall back to
        // their request date.
        tradingViewGrantedAt: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true })
        .then(() => {
          if (typeof createNotification === 'function') {
            createNotification(uid, 'tv_access_granted', 'Your TradingView indicator access has been granted.', 'indicators.html');
          }
          if (typeof checkAndNotifyNewAchievementsFor === 'function') checkAndNotifyNewAchievementsFor(uid, true);
        })
        .then(loadTvRequests);
      }).catch((err) => {
        // A failed TradingView grant lands here too — nothing was recorded,
        // so the student still shows as pending and the click can be retried
        // (or the grant done manually with auto-grant switched off).
        showToast('error', (TV_CFG.enabled ? 'TradingView: ' : 'Could not update: ') + (err.message || err));
        btn.disabled = false;
        btn.textContent = TV_CFG.enabled ? 'Grant on TradingView' : 'Mark as granted';
      });
    });
  });
}

let TV_STUDENTS = [];

function loadTvRequests(){
  return db.collection('students').get().then((snap) => {
    TV_STUDENTS = [];
    snap.forEach((doc) => TV_STUDENTS.push(Object.assign({ uid: doc.id }, doc.data())));
    renderTvRequestsPanel(TV_STUDENTS);
    renderTvApprovedPanel();
  }).catch((err) => console.error('Stryker: failed to load TradingView requests', err));
}

// ---------------------------------------------------------------------------
// Approved access — everyone whose TradingView username has been granted,
// with their basic account details, searchable / filterable / sortable.
// One in-memory pass over the students already fetched for the pending
// panel; no extra reads, and typing in the search box re-renders instantly.
// ---------------------------------------------------------------------------

function tvMs(t){ return (t && typeof t.toMillis === 'function') ? t.toMillis() : 0; }

function tvDateLabel(t){
  return (t && typeof t.toDate === 'function')
    ? t.toDate().toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
    : '—';
}

function renderTvApprovedPanel(){
  const list = document.getElementById('tv-approved-list');
  const countEl = document.getElementById('tv-approved-count');
  const searchEl = document.getElementById('tv-approved-search');
  const filterEl = document.getElementById('tv-approved-filter');
  const sortEl = document.getElementById('tv-approved-sort');
  if (!list) return;

  const approved = TV_STUDENTS.filter((s) => s.tradingViewUsername && s.tradingViewAccessGranted);

  // Plan filter options come from the data itself, so a renamed or added
  // plan shows up without touching this file. The current selection is
  // preserved across re-renders (this runs on every keystroke).
  const plans = Array.from(new Set(approved.map((s) => s.plan).filter(Boolean))).sort();
  const current = filterEl.value || 'all';
  filterEl.innerHTML = '<option value="all">All plans</option>' +
    plans.map((p) => '<option value="' + escapeIndicatorsAdminText(p) + '">' + escapeIndicatorsAdminText(p) + '</option>').join('') +
    '<option value="__founding">★ Founding members</option>';
  filterEl.value = Array.from(filterEl.options).some((o) => o.value === current) ? current : 'all';

  const q = (searchEl.value || '').trim().toLowerCase();
  let rows = approved.filter((s) => {
    if (filterEl.value === '__founding' && !s.foundingMember) return false;
    if (filterEl.value !== 'all' && filterEl.value !== '__founding' && s.plan !== filterEl.value) return false;
    if (!q) return true;
    return [s.tradingViewUsername, s.displayName, s.name, s.email]
      .some((v) => v && String(v).toLowerCase().includes(q));
  });

  const grantedMs = (s) => tvMs(s.tradingViewGrantedAt) || tvMs(s.tradingViewRequestedAt) || tvMs(s.createdAt);
  const nameOf = (s) => (s.displayName || s.name || s.email || '').toLowerCase();
  const sorts = {
    'granted-desc': (a, b) => grantedMs(b) - grantedMs(a),
    'granted-asc': (a, b) => grantedMs(a) - grantedMs(b),
    'username': (a, b) => String(a.tradingViewUsername).toLowerCase().localeCompare(String(b.tradingViewUsername).toLowerCase()),
    'name': (a, b) => nameOf(a).localeCompare(nameOf(b)),
    'plan': (a, b) => ((typeof rankOf === 'function') ? rankOf(b.plan) - rankOf(a.plan) : 0) || nameOf(a).localeCompare(nameOf(b)),
    'joined-desc': (a, b) => tvMs(b.createdAt) - tvMs(a.createdAt)
  };
  rows.sort(sorts[sortEl.value] || sorts['granted-desc']);

  countEl.textContent = approved.length + ' approved' +
    (rows.length !== approved.length ? ' · ' + rows.length + ' shown' : '');

  if (!approved.length) {
    list.innerHTML = '<p style="color:var(--ink-3); font-size:13.5px;">No approved usernames yet — grant a pending request above and it appears here.</p>';
    return;
  }
  if (!rows.length) {
    list.innerHTML = '<p style="color:var(--ink-3); font-size:13.5px;">Nothing matches that search/filter.</p>';
    return;
  }

  list.innerHTML = '';
  rows.forEach((s) => {
    const name = s.displayName || s.name || (s.email ? s.email.split('@')[0] : 'Trader');
    const planTag = (typeof roleTagHtml === 'function' && s.plan) ? roleTagHtml(s.plan, { size: 'small' }) : '';
    const row = document.createElement('div');
    row.className = 'record-card';
    row.innerHTML =
      '<div style="flex:1 1 220px; min-width:0;">' +
        '<span class="cell-name" style="font-family:var(--font-mono);">' + escapeIndicatorsAdminText(s.tradingViewUsername) + '</span>' +
        '<span class="cell-sub" style="display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">' +
          escapeIndicatorsAdminText(name) + planTag +
          (s.foundingMember ? ' <span style="color:var(--gold); font-weight:700;">★</span>' : '') +
          (s.email ? ' · ' + escapeIndicatorsAdminText(s.email) : '') + '</span>' +
      '</div>' +
      '<div class="record-stats">' +
        '<div class="record-stat"><span class="rs-label">Member since</span><span class="rs-val">' + tvDateLabel(s.createdAt) + '</span></div>' +
        '<div class="record-stat"><span class="rs-label">Granted</span><span class="rs-val">' + tvDateLabel(s.tradingViewGrantedAt || s.tradingViewRequestedAt) + '</span></div>' +
      '</div>' +
      '<button class="btn btn-ghost btn-sm" data-revoke-tv="' + escapeIndicatorsAdminText(s.uid) + '" style="border-color:rgba(229,72,77,0.35);">Revoke</button>';
    list.appendChild(row);
  });

  list.querySelectorAll('[data-revoke-tv]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const uid = btn.dataset.revokeTv;
      const s = TV_STUDENTS.find((x) => x.uid === uid);
      if (!s) return;
      if (!confirm('Revoke TradingView access for "' + (s.tradingViewUsername || uid) + '"?\n\n' +
                   (TV_CFG.enabled
                     ? 'Auto-grant is ON, so this also removes their access on TradingView itself.'
                     : 'This updates the site\'s record — also remove them on TradingView\'s Manage Access page.'))) return;
      btn.disabled = true;

      const tvFirst = TV_CFG.enabled
        ? (btn.textContent = 'Revoking…',
           tvCall('tvRevokeAccess', { username: s.tradingViewUsername }).then(() => {
             showToast('success', 'Removed on TradingView.');
           }))
        : Promise.resolve();

      tvFirst.then(() => {
        if (typeof logActivity === 'function') logActivity('content.indicator_saved', 'Revoked TradingView indicator access', { targetUid: uid });
        return db.collection('students').doc(uid).set({ tradingViewAccessGranted: false }, { merge: true });
      })
        .then(loadTvRequests)
        .catch((err) => {
          showToast('error', 'Could not revoke: ' + (err.message || err));
          btn.disabled = false;
          btn.textContent = 'Revoke';
        });
    });
  });
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
    // Config first, then the lists — the pending panel's button label
    // ("Grant on TradingView" vs "Mark as granted") depends on it.
    loadTvConfig().then(loadTvRequests);
  });

  const tvSaveBtn = document.getElementById('tv-auto-save');
  if (tvSaveBtn) tvSaveBtn.addEventListener('click', saveTvConfig);

  // Search / filter / sort re-render the approved list from the students
  // already in memory — no Firestore reads on keystrokes.
  const searchEl = document.getElementById('tv-approved-search');
  const filterEl = document.getElementById('tv-approved-filter');
  const sortEl = document.getElementById('tv-approved-sort');
  if (searchEl) searchEl.addEventListener('input', renderTvApprovedPanel);
  if (filterEl) filterEl.addEventListener('change', renderTvApprovedPanel);
  if (sortEl) sortEl.addEventListener('change', renderTvApprovedPanel);
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
    const items = [];
    snap.forEach((d) => items.push(d.data()));
    if (typeof SHOWCASE_SEED === 'undefined' || !SHOWCASE_SEED.length) return items;

    // Seed whatever is MISSING, not just an empty collection: a new indicator
    // shipped in SHOWCASE_SEED (e.g. Liquidity Master) must reach Firestore
    // even after the original cards were seeded. Existing docs are never
    // touched, so admin edits always win over the bundled defaults.
    const have = new Set(items.map((it) => it.id));
    const missing = SHOWCASE_SEED.filter((it) => !have.has(it.id));
    if (!missing.length) {
      items.sort((a, b) => (a.order || 0) - (b.order || 0));
      return items;
    }
    const batch = db.batch();
    missing.forEach((it) => batch.set(db.collection('showcaseIndicators').doc(it.id), it));
    return batch.commit().then(() => {
      const all = items.concat(missing);
      all.sort((a, b) => (a.order || 0) - (b.order || 0));
      return all;
    });
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
