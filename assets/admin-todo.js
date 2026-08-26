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

// Task sources now live in assets/admin-tasks.js, shared with the notification
// bell. Two copies would drift: a source added here would never appear in the
// bell, and the two would disagree about how much is outstanding.

function renderTodo(){
  const wrap = document.getElementById('todo-list');
  const countEl = document.getElementById('todo-count');
  if (!wrap) return;

  // A derived task is hidden while its dismissed signature still matches the
  // current count. More items than when it was dismissed and it returns.
  const visibleDerived = TODO_DERIVED.filter((t) => adminTaskIsVisible(t, TODO_DISMISSALS));

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
        '<a href="' + t.link + '" class="todo-act"' + (t.opensBell ? ' data-open-bell' : '') +
          ' aria-label="Open the page that handles this" data-tip="Open the page that handles this">' +
          '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
          '<path d="M5 12h14"/><path d="M13 6l6 6-6 6"/></svg>' +
        '</a>' +
        (t.opensBell ? '' :
          '<button type="button" class="todo-act todo-act-done" data-todo-dismiss="' + t.key + '" ' +
            'data-signature="' + t.count + '" aria-label="Mark as handled" data-tip="Mark as handled — returns if new items arrive">' +
            '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">' +
            '<path d="M20 6L9 17l-5-5"/></svg>' +
          '</button>') +
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

  wrap.querySelectorAll('[data-open-bell]').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      const bell = document.getElementById('notif-bell-btn');
      if (bell) bell.click();
    });
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

  // Shared loader — same data the notification bell reads, so the panel and
  // the bell can never disagree about what is outstanding.
  const derived = loadAdminTaskCounts()
    .then((tasks) => tasks.map((t) => Object.assign({}, t.src, { count: t.count })));

  const dismissals = loadAdminTaskDismissals();

  const manual = db.collection('adminTasks').orderBy('createdAt', 'desc').limit(50).get()
    .then((snap) => {
      const list = [];
      snap.forEach((d) => list.push(Object.assign({ id: d.id }, d.data())));
      return list;
    })
    .catch(() => []);

  Promise.all([derived, dismissals, manual]).then(([d, dis, man]) => {
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
