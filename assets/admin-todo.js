// Stryker Trading Academy — Admin: action queue (dashboard-admin.html)
// Depends on: assets/auth.js, assets/progress.js (db), assets/admin-guard.js
//
// WHY TASKS ARE DERIVED, NOT WRITTEN
// The obvious design is to create a task document whenever a student flags a
// post or submits a TradingView username. That needs every creation point
// instrumented, misses everything already pending, and drifts: a task saying
// "review this post" outlives the post being deleted somewhere else.
//
// So the automatic tasks are QUERIES against the data that already exists.
// The queue cannot disagree with reality because it is computed from it, it
// covers a backlog that predates this feature, and nothing new has to be
// remembered when another admin surface is added later.
//
// WHAT "DONE" MEANS FOR A DERIVED TASK
// A derived task can't simply be deleted — the underlying posts are still
// there and it would reappear on reload. Dismissing therefore records a
// SIGNATURE (the current count). The task stays hidden while the count
// matches, and comes back the moment new items arrive. So "Done" means
// "I've dealt with these", not "hide this forever" — three new flagged posts
// tomorrow will surface again rather than being silently swallowed.
//
// Manual tasks are ordinary documents and are deleted outright when completed.

let TODO_DISMISSALS = {};
let TODO_MANUAL = [];
let TODO_DERIVED = [];

function todoEscape(s){
  return String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Each source: a key, a query, and how to phrase the result.
const TODO_SOURCES = [
  {
    key: 'moderation',
    link: 'moderation-admin.html',
    icon: '<path d="M12 2l8 4v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6z"/>',
    tone: 'urgent',
    load: () => db.collection('communityPosts').where('hidden', '==', true).get()
      .then((snap) => snap.size),
    label: (n) => n + (n === 1 ? ' flagged post needs review' : ' flagged posts need review'),
    sub: 'A moderator hid these pending your decision.'
  },
  {
    key: 'tradingview',
    link: 'indicators-admin.html',
    icon: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
    tone: 'normal',
    load: () => db.collection('students').get().then((snap) => {
      let n = 0;
      snap.forEach((d) => {
        const s = d.data();
        if (s.tradingViewUsername && !s.tradingViewAccessGranted) n++;
      });
      return n;
    }),
    label: (n) => n + (n === 1 ? ' TradingView username awaiting approval' : ' TradingView usernames awaiting approval'),
    sub: 'Students cannot load the indicators until these are granted.'
  },
  {
    key: 'contact',
    link: 'pages-admin.html',
    icon: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="M22 6l-10 7L2 6"/>',
    tone: 'normal',
    load: () => db.collection('contactMessages').where('status', '==', 'new').get()
      .then((snap) => snap.size),
    label: (n) => n + (n === 1 ? ' unread contact message' : ' unread contact messages'),
    sub: 'Sent through the public contact form.'
  }
];

function renderTodo(){
  const wrap = document.getElementById('todo-list');
  const countEl = document.getElementById('todo-count');
  if (!wrap) return;

  // A derived task is hidden while its dismissed signature still matches the
  // current count. More items than when it was dismissed and it returns.
  const visibleDerived = TODO_DERIVED.filter((t) => {
    if (!t.count) return false;
    const d = TODO_DISMISSALS[t.key];
    return !d || d.signature !== t.count;
  });

  const total = visibleDerived.length + TODO_MANUAL.length;
  if (countEl) countEl.textContent = total ? (total + (total === 1 ? ' task' : ' tasks')) : 'All clear';

  if (!total) {
    wrap.innerHTML =
      '<div class="todo-empty">' +
        '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6L9 17l-5-5"/></svg>' +
        '<p>Nothing waiting on you right now.</p>' +
      '</div>';
    return;
  }

  wrap.innerHTML = '';

  visibleDerived.forEach((t) => {
    const row = document.createElement('div');
    row.className = 'todo-item' + (t.tone === 'urgent' ? ' urgent' : '');
    row.innerHTML =
      '<span class="todo-icon"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9">' + t.icon + '</svg></span>' +
      '<div class="todo-text">' +
        '<a href="' + t.link + '" class="todo-title">' + todoEscape(t.label(t.count)) + '</a>' +
        '<span class="todo-sub">' + todoEscape(t.sub) + '</span>' +
      '</div>' +
      '<div class="todo-actions">' +
        '<a href="' + t.link + '" class="todo-act" aria-label="Open the page that handles this" data-tip="Open the page that handles this">' +
          '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
          '<path d="M5 12h14"/><path d="M13 6l6 6-6 6"/></svg>' +
        '</a>' +
        '<button type="button" class="todo-act todo-act-done" data-todo-dismiss="' + t.key + '" ' +
          'data-signature="' + t.count + '" aria-label="Mark as handled" data-tip="Mark as handled — returns if new items arrive">' +
          '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">' +
          '<path d="M20 6L9 17l-5-5"/></svg>' +
        '</button>' +
      '</div>';
    wrap.appendChild(row);
  });

  TODO_MANUAL.forEach((t) => {
    const row = document.createElement('div');
    row.className = 'todo-item';
    row.innerHTML =
      '<span class="todo-icon"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><circle cx="12" cy="12" r="9"/></svg></span>' +
      '<div class="todo-text"><span class="todo-title">' + todoEscape(t.text) + '</span>' +
        '<span class="todo-sub">Added by you</span></div>' +
      '<div class="todo-actions">' +
        '<button type="button" class="todo-act todo-act-done" data-todo-complete="' + t.id + '" ' +
          'aria-label="Complete and remove this reminder" data-tip="Complete and remove this reminder">' +
          '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">' +
          '<path d="M20 6L9 17l-5-5"/></svg>' +
        '</button>' +
      '</div>';
    wrap.appendChild(row);
  });

  wrap.querySelectorAll('[data-todo-dismiss]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const key = btn.getAttribute('data-todo-dismiss');
      const signature = parseInt(btn.getAttribute('data-signature'), 10);
      btn.disabled = true;
      btn.classList.add('is-busy');
      db.collection('adminTaskDismissals').doc(key).set({
        signature: signature,
        dismissedAt: firebase.firestore.FieldValue.serverTimestamp(),
        dismissedBy: auth.currentUser ? auth.currentUser.uid : null
      }).then(() => {
        TODO_DISMISSALS[key] = { signature: signature };
        renderTodo();
      }).catch((err) => {
        showToast('error', 'Could not dismiss: ' + (err.message || err));
        btn.disabled = false;
        btn.classList.remove('is-busy');
      });
    });
  });

  wrap.querySelectorAll('[data-todo-complete]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-todo-complete');
      btn.disabled = true;
      btn.classList.add('is-busy');
      db.collection('adminTasks').doc(id).delete().then(() => {
        TODO_MANUAL = TODO_MANUAL.filter((t) => t.id !== id);
        if (typeof logActivity === 'function') logActivity('admin.task_done', 'Completed an admin task');
        renderTodo();
      }).catch((err) => {
        showToast('error', 'Could not complete: ' + (err.message || err));
        btn.disabled = false;
        btn.classList.remove('is-busy');
      });
    });
  });
}

function loadTodo(){
  const wrap = document.getElementById('todo-list');
  if (!wrap) return;

  // All sources in parallel; a single failing query must not blank the whole
  // queue, so each resolves to a count of 0 rather than rejecting.
  const derived = TODO_SOURCES.map((src) =>
    src.load()
      .then((count) => Object.assign({}, src, { count: count }))
      .catch((err) => {
        console.error('Stryker: todo source failed: ' + src.key, err);
        return Object.assign({}, src, { count: 0 });
      })
  );

  const dismissals = db.collection('adminTaskDismissals').get()
    .then((snap) => {
      const map = {};
      snap.forEach((d) => { map[d.id] = d.data(); });
      return map;
    })
    .catch(() => ({}));

  const manual = db.collection('adminTasks').orderBy('createdAt', 'desc').limit(50).get()
    .then((snap) => {
      const list = [];
      snap.forEach((d) => list.push(Object.assign({ id: d.id }, d.data())));
      return list;
    })
    .catch(() => []);

  Promise.all([Promise.all(derived), dismissals, manual]).then(([d, dis, man]) => {
    TODO_DERIVED = d;
    TODO_DISMISSALS = dis;
    TODO_MANUAL = man;
    renderTodo();
  });
}

function addManualTask(){
  const input = document.getElementById('todo-new-input');
  const text = input.value.trim();
  if (!text) return;

  const btn = document.getElementById('todo-add-btn');
  btn.disabled = true;

  db.collection('adminTasks').add({
    text: text,
    createdBy: auth.currentUser ? auth.currentUser.uid : null,
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  }).then((ref) => {
    // Pushed to the front locally rather than reloading: the serverTimestamp
    // is not resolved yet, so a re-query could order it unpredictably against
    // tasks added in the same second.
    TODO_MANUAL.unshift({ id: ref.id, text: text });
    input.value = '';
    btn.disabled = false;
    if (typeof logActivity === 'function') logActivity('admin.task_added', 'Added an admin task: ' + text);
    renderTodo();
  }).catch((err) => {
    showToast('error', 'Could not add the task: ' + (err.message || err));
    btn.disabled = false;
  });
}

document.addEventListener('DOMContentLoaded', () => {
  if (!document.getElementById('todo-list')) return;

  const addBtn = document.getElementById('todo-add-btn');
  if (addBtn) addBtn.addEventListener('click', addManualTask);

  const input = document.getElementById('todo-new-input');
  if (input) {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); addManualTask(); }
    });
  }

  // guardAdminPage already runs on this page for the rest of the dashboard;
  // this just waits for auth so the queries are made as a signed-in admin.
  if (typeof auth !== 'undefined' && auth) {
    let done = false;
    auth.onAuthStateChanged((user) => {
      if (done || !user) return;
      done = true;
      loadTodo();
    });
  }
});
