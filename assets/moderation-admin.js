// Stryker Trading Academy — Admin: Moderation (moderation-admin.html)
// Depends on: assets/auth.js, assets/progress.js (for `db`), assets/admin-guard.js
//
// Shows posts a moderator has hidden (communityPosts where hidden == true),
// each with the moderator's note context and two resolving actions:
// Restore (clears hidden — the post reappears in the normal feed exactly
// as it was) or Delete permanently (removes the document entirely, same
// as a student deleting their own post, just admin-initiated).
//
// Deliberately no orderBy in the query — a single where() on `hidden`
// doesn't need a composite index, and sorting the (typically small)
// result client-side avoids requiring one just for this admin queue.

function escapeModText(s){
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function renderModerationQueue(posts){
  const listEl = document.getElementById('moderation-list');
  const countEl = document.getElementById('moderation-count');
  if (countEl) countEl.textContent = posts.length + ' pending';

  if (!posts.length) {
    listEl.innerHTML = '<p style="color:var(--ink-3); font-size:13.5px; padding:16px;">Nothing waiting on review right now.</p>';
    return;
  }

  listEl.innerHTML = '';
  posts.forEach((post) => {
    const moderatedDate = post.moderatedAt && post.moderatedAt.toDate ? post.moderatedAt.toDate() : null;
    const when = moderatedDate ? moderatedDate.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—';

    const card = document.createElement('div');
    card.className = 'record-card';
    card.innerHTML =
      '<div class="cell-user"><div><span class="cell-name">' + escapeModText(post.authorName || 'Trader') + '</span>' +
      '<span class="cell-sub">Flagged ' + when + ' · category: ' + escapeModText(post.category || 'general') + '</span></div></div>' +
      '<div style="font-size:13.5px; color:var(--ink-1); line-height:1.5; padding:10px 0; border-top:1px solid var(--line-soft); border-bottom:1px solid var(--line-soft); margin:8px 0;">' +
        (post.textHtml || '<em style="color:var(--ink-3);">(no text)</em>') +
      '</div>' +
      (post.imageDataUrl ? '<img src="' + post.imageDataUrl + '" alt="" style="max-width:220px; border-radius:8px; border:1px solid var(--line); display:block; margin-bottom:10px;">' : '') +
      '<div style="display:flex; gap:8px; flex-wrap:wrap;">' +
        '<button class="btn btn-sm btn-primary" data-restore="' + post.id + '">Restore</button>' +
        '<button class="btn btn-sm btn-ghost" data-delete-permanently="' + post.id + '" style="border-color:rgba(229,72,77,0.35);">Delete permanently</button>' +
      '</div>';

    card.querySelector('[data-restore]').addEventListener('click', (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      db.collection('communityPosts').doc(post.id).update({
        hidden: false,
        moderatedBy: firebase.firestore.FieldValue.delete(),
        moderatedAt: firebase.firestore.FieldValue.delete()
      }).then(loadModerationQueue).catch((err) => {
        alert('Could not restore: ' + (err.message || err));
        btn.disabled = false;
      });
    });

    card.querySelector('[data-delete-permanently]').addEventListener('click', (e) => {
      const btn = e.currentTarget;
      if (!confirm('Permanently delete this post? This cannot be undone.')) return;
      btn.disabled = true;
      db.collection('communityPosts').doc(post.id).delete()
        .then(loadModerationQueue).catch((err) => {
          alert('Could not delete: ' + (err.message || err));
          btn.disabled = false;
        });
    });

    listEl.appendChild(card);
  });
}

function loadModerationQueue(){
  return db.collection('communityPosts').where('hidden', '==', true).get().then((snap) => {
    const posts = [];
    snap.forEach((doc) => posts.push(Object.assign({ id: doc.id }, doc.data())));
    posts.sort((a, b) => {
      const at = a.moderatedAt && a.moderatedAt.toMillis ? a.moderatedAt.toMillis() : 0;
      const bt = b.moderatedAt && b.moderatedAt.toMillis ? b.moderatedAt.toMillis() : 0;
      return bt - at; // most recently flagged first
    });
    renderModerationQueue(posts);
  }).catch((err) => {
    console.error('Stryker: failed to load moderation queue', err);
    document.getElementById('moderation-list').innerHTML =
      '<p style="color:var(--ink-3); font-size:13.5px;">Could not load the queue: ' + (err.message || err) + '</p>';
  });
}

document.addEventListener('DOMContentLoaded', () => {
  guardAdminPage(() => {
    loadModerationQueue();
  });
});
