// Stryker Trading Academy — Trading Floor (trading-floor.html)
// Depends on: assets/auth.js, assets/progress.js (for `db`)
// Posts live in the top-level `communityPosts` collection. Anyone signed in
// can read and post; a user can only delete their own post (see Firestore
// security rules).

let FLOOR_UID = null;
let FLOOR_NAME = 'Trader';

function timeAgo(date){
  if (!date) return '';
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const mins = Math.floor(seconds / 60);
  if (mins < 60) return mins + 'm ago';
  const hours = Math.floor(mins / 60);
  if (hours < 24) return hours + 'h ago';
  const days = Math.floor(hours / 24);
  return days + 'd ago';
}

function renderPosts(posts){
  const list = document.getElementById('floor-list');
  const countEl = document.getElementById('floor-count');
  if (countEl) countEl.textContent = posts.length + ' post' + (posts.length === 1 ? '' : 's');

  if (!posts.length) {
    list.innerHTML = '<p style="color:var(--ink-3); font-size:13.5px;">No posts yet — be the first to share something with the floor.</p>';
    return;
  }

  list.innerHTML = '';
  posts.forEach((post) => {
    const createdDate = post.createdAt && typeof post.createdAt.toDate === 'function' ? post.createdAt.toDate() : null;
    const row = document.createElement('div');
    row.className = 'continue-row';
    row.style.alignItems = 'flex-start';
    const isOwn = post.authorUid === FLOOR_UID;
    row.innerHTML =
      '<div class="chip-avatar" style="flex-shrink:0; margin-top:2px;"></div>' +
      '<div class="continue-body">' +
        '<h4 style="margin-bottom:4px;">' + (post.authorName || 'Trader') +
          ' <span style="color:var(--ink-3); font-weight:400; font-size:11.5px; font-family:var(--font-mono);">· ' + timeAgo(createdDate) + '</span></h4>' +
        '<p style="font-size:13.5px; color:var(--ink-1); margin:0;">' + (post.text || '').replace(/</g, '&lt;') + '</p>' +
      '</div>' +
      (isOwn ? '<button class="icon-btn" data-post-id="' + post.id + '" title="Delete post"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14z"/></svg></button>' : '');

    if (isOwn) {
      row.querySelector('[data-post-id]').addEventListener('click', () => deletePost(post.id));
    }
    list.appendChild(row);
  });
}

function loadPosts(){
  db.collection('communityPosts').orderBy('createdAt', 'desc').limit(50).get()
    .then((snap) => {
      const posts = [];
      snap.forEach((doc) => posts.push(Object.assign({ id: doc.id }, doc.data())));
      renderPosts(posts);
    })
    .catch((err) => {
      console.error('Stryker: failed to load trading floor posts', err);
      document.getElementById('floor-list').innerHTML =
        '<p style="color:var(--ink-3); font-size:13.5px;">Could not load posts: ' + (err.message || err) + '</p>';
    });
}

function deletePost(id){
  if (!confirm('Delete this post?')) return;
  db.collection('communityPosts').doc(id).delete()
    .then(loadPosts)
    .catch((err) => alert('Could not delete post: ' + (err.message || err)));
}

document.addEventListener('DOMContentLoaded', () => {
  if (!auth) return;
  let handled = false;
  auth.onAuthStateChanged((user) => {
    if (handled) return;
    if (!user) {
      setTimeout(() => { if (!handled) window.location.href = 'login.html'; }, 1500);
      return;
    }
    handled = true;
    FLOOR_UID = user.uid;
    FLOOR_NAME = user.displayName || (user.email ? user.email.split('@')[0] : 'Trader');
    loadPosts();
  });

  document.getElementById('floor-post-btn').addEventListener('click', () => {
    const errEl = document.getElementById('floor-error');
    errEl.style.display = 'none';
    if (!FLOOR_UID) return;

    const textEl = document.getElementById('floor-post-text');
    const text = textEl.value.trim();
    if (!text) {
      errEl.textContent = 'Write something before posting.';
      errEl.style.display = 'block';
      return;
    }

    const btn = document.getElementById('floor-post-btn');
    btn.disabled = true;

    db.collection('communityPosts').add({
      authorUid: FLOOR_UID,
      authorName: FLOOR_NAME,
      text: text,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    }).then(() => {
      textEl.value = '';
      loadPosts();
    }).catch((err) => {
      errEl.textContent = err.message || 'Could not post.';
      errEl.style.display = 'block';
    }).finally(() => { btn.disabled = false; });
  });
});
