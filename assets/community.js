// Stryker Trading Academy — Trading Floor (trading-floor.html)
// Depends on: assets/auth.js, assets/progress.js (`db`)
//
// Data model:
//   communityPosts/{postId}: { authorUid, authorName, textHtml, imageDataUrl,
//     createdAt, likedBy: [uid], upvotedBy: [uid], downvotedBy: [uid], replyCount }
//   communityPosts/{postId}/replies/{replyId}: { authorUid, authorName, text, createdAt }
//   students/{uid}/bookmarks/{postId}: { createdAt }  (private — own bookmarks only)
//
// Reaction arrays (likedBy/upvotedBy/downvotedBy) double as both the "did I
// react" check (array membership, no extra reads needed) and the count
// (array length) — no separate counters to drift out of sync. Firestore
// rules restrict updates to ONLY those fields plus replyCount, so no one can
// use a reaction click to silently rewrite someone else's post text.

let FLOOR_UID = null;
let FLOOR_NAME = 'Trader';
let FLOOR_PLAN = null; // the current user's plan name, stamped onto posts/replies they create so the role tag can render without an extra lookup per post
let ALL_POSTS = [];
let CURRENT_SORT = 'new';
let ACTIVE_TAG = null;
let PENDING_IMAGE_DATA_URL = null;
let BOOKMARKED_IDS = new Set();

/* ---------------- helpers ---------------- */

function resizeImageToDataUrl(file, maxDim, mimeType){
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read the selected file.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('That file could not be read as an image.'));
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          const scale = maxDim / Math.max(width, height);
          width = Math.round(width * scale);
          height = Math.round(height * scale);
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL(mimeType || 'image/jpeg', 0.82));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function escapeHtml(s){
  return (s || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Wraps #hashtag and @mention patterns in styled, clickable spans. Runs on
// already-sanitized HTML from the rich text editor (execCommand output),
// operating on text nodes only so it never touches existing tags.
function linkifyTags(html){
  const container = document.createElement('div');
  container.innerHTML = html;
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const textNodes = [];
  let node;
  while ((node = walker.nextNode())) textNodes.push(node);

  textNodes.forEach((textNode) => {
    const text = textNode.nodeValue;
    if (!/[@#]\w+/.test(text)) return;
    const frag = document.createDocumentFragment();
    let lastIndex = 0;
    text.replace(/([@#])(\w+)/g, (match, symbol, word, offset) => {
      frag.appendChild(document.createTextNode(text.slice(lastIndex, offset)));
      const span = document.createElement('span');
      span.className = 'floor-tag';
      span.dataset.tag = symbol + word;
      span.dataset.tagType = symbol === '#' ? 'hashtag' : 'mention';
      span.textContent = match;
      frag.appendChild(span);
      lastIndex = offset + match.length;
      return match;
    });
    frag.appendChild(document.createTextNode(text.slice(lastIndex)));
    textNode.parentNode.replaceChild(frag, textNode);
  });

  return container.innerHTML;
}

function initials(name){
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  return (parts[0][0] + (parts[1] ? parts[1][0] : '')).toUpperCase();
}

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

function initRichTextToolbar(toolbarId, editableId){
  const editable = document.getElementById(editableId);
  document.querySelectorAll('#' + toolbarId + ' .rte-btn[data-cmd]').forEach((btn) => {
    btn.addEventListener('click', () => {
      editable.focus();
      document.execCommand(btn.dataset.cmd, false, btn.dataset.value || undefined);
    });
  });
}

/* ---------------- sorting ---------------- */

function score(post){
  return (post.likedBy || []).length + (post.upvotedBy || []).length - (post.downvotedBy || []).length;
}

function hotScore(post){
  const created = post.createdAt && post.createdAt.toDate ? post.createdAt.toDate() : new Date();
  const hours = Math.max((Date.now() - created.getTime()) / 3600000, 0);
  return (score(post) + 1) / Math.pow(hours + 2, 1.5);
}

function sortedPosts(){
  let list = ALL_POSTS.slice();
  if (ACTIVE_TAG) {
    const needle = ACTIVE_TAG.toLowerCase();
    list = list.filter(p => (p.textHtml || '').toLowerCase().includes(needle));
  }
  if (CURRENT_SORT === 'top') list.sort((a, b) => score(b) - score(a));
  else if (CURRENT_SORT === 'hot') list.sort((a, b) => hotScore(b) - hotScore(a));
  else list.sort((a, b) => {
    const at = a.createdAt && a.createdAt.toMillis ? a.createdAt.toMillis() : 0;
    const bt = b.createdAt && b.createdAt.toMillis ? b.createdAt.toMillis() : 0;
    return bt - at;
  });
  return list;
}

/* ---------------- rendering ---------------- */

function renderTagBanner(){
  const el = document.getElementById('floor-active-tag-banner');
  if (!ACTIVE_TAG) { el.style.display = 'none'; return; }
  el.style.display = 'block';
  el.innerHTML = '';
  const banner = document.createElement('div');
  banner.className = 'tag-active-banner';
  banner.innerHTML = '<span>Filtering by <b>' + escapeHtml(ACTIVE_TAG) + '</b></span>';
  const clearBtn = document.createElement('button');
  clearBtn.type = 'button';
  clearBtn.textContent = 'Clear filter';
  clearBtn.addEventListener('click', () => { ACTIVE_TAG = null; renderFeed(); });
  banner.appendChild(clearBtn);
  el.appendChild(banner);
}

// Cache of {plan, photoURL, customPhotoURL, displayName} per author uid,
// fetched once per unique author per feed render — used for both the role
// tag and the avatar image, so both always reflect the author's CURRENT
// profile rather than whatever was true the moment they posted.
let AUTHOR_DATA_CACHE = {};

function prefetchAuthorData(list){
  const uids = new Set();
  list.forEach((post) => { if (post.authorUid) uids.add(post.authorUid); });
  const toFetch = Array.from(uids).filter((uid) => !(uid in AUTHOR_DATA_CACHE));
  if (!toFetch.length || typeof db === 'undefined' || !db) return Promise.resolve();

  return Promise.all(toFetch.map((uid) =>
    db.collection('students').doc(uid).get()
      .then((doc) => { AUTHOR_DATA_CACHE[uid] = doc.exists ? doc.data() : null; })
      .catch(() => { AUTHOR_DATA_CACHE[uid] = null; })
  ));
}

function renderFeed(){
  renderTagBanner();
  const list = sortedPosts();
  const countEl = document.getElementById('floor-count');
  countEl.textContent = list.length + ' post' + (list.length === 1 ? '' : 's');

  const feedEl = document.getElementById('floor-list');
  if (!list.length) {
    feedEl.innerHTML = '<p style="color:var(--ink-3); font-size:13.5px;">' +
      (ACTIVE_TAG ? 'No posts match that tag.' : 'No posts yet — be the first to share something with the floor.') + '</p>';
    return;
  }
  prefetchAuthorData(list).then(() => {
    feedEl.innerHTML = '';
    list.forEach((post) => feedEl.appendChild(renderPostCard(post)));
  });
}

function renderPostCard(post){
  const createdDate = post.createdAt && post.createdAt.toDate ? post.createdAt.toDate() : null;
  const liked = (post.likedBy || []).includes(FLOOR_UID);
  const upvoted = (post.upvotedBy || []).includes(FLOOR_UID);
  const downvoted = (post.downvotedBy || []).includes(FLOOR_UID);
  const bookmarked = BOOKMARKED_IDS.has(post.id);

  const el = document.createElement('div');
  el.className = 'floor-post';
  const roleTag = (typeof roleTagHtml === 'function') ? roleTagHtml(post.authorPlan || (AUTHOR_DATA_CACHE[post.authorUid] && AUTHOR_DATA_CACHE[post.authorUid].plan), { size: 'small' }) : '';
  const avatarHtml = (typeof avatarImgHtml === 'function')
    ? avatarImgHtml(post.authorUid, post.authorName, AUTHOR_DATA_CACHE[post.authorUid], 36)
    : ('<div class="floor-avatar">' + initials(post.authorName) + '</div>');
  el.innerHTML =
    '<div class="floor-post-head">' +
      avatarHtml +
      '<div><div class="floor-post-name">' + escapeHtml(post.authorName || 'Trader') + roleTag + '</div>' +
      '<div class="floor-post-time">' + timeAgo(createdDate) + '</div></div>' +
      (post.authorUid === FLOOR_UID ? '<button type="button" class="icon-btn" style="margin-left:auto;" data-delete-post title="Delete post"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14z"/></svg></button>' : '') +
    '</div>' +
    '<div class="floor-post-body">' + (post.textHtml || '') + '</div>' +
    (post.imageDataUrl ? '<img class="floor-post-image" src="' + post.imageDataUrl + '" alt="">' : '') +
    '<div class="floor-actions">' +
      '<button type="button" class="floor-action-btn' + (liked ? ' active' : '') + '" data-action="like" title="Like">' +
        '<svg width="17" height="17" viewBox="0 0 24 24" fill="' + (liked ? 'currentColor' : 'none') + '" stroke="currentColor" stroke-width="2"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8z"/></svg>' +
        '<span>' + (post.likedBy || []).length + '</span>' +
      '</button>' +
      '<button type="button" class="floor-action-btn' + (upvoted ? ' active' : '') + '" data-action="upvote" title="Upvote">' +
        '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 19V6M6 12l6-6 6 6"/></svg>' +
        '<span>' + (post.upvotedBy || []).length + '</span>' +
      '</button>' +
      '<button type="button" class="floor-action-btn' + (downvoted ? ' active downvote-active' : '') + '" data-action="downvote" title="Downvote">' +
        '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 5v13M6 12l6 6 6-6"/></svg>' +
        '<span>' + (post.downvotedBy || []).length + '</span>' +
      '</button>' +
      '<button type="button" class="floor-action-btn' + (bookmarked ? ' active bookmark-active' : '') + '" data-action="bookmark" title="Save">' +
        '<svg width="17" height="17" viewBox="0 0 24 24" fill="' + (bookmarked ? 'currentColor' : 'none') + '" stroke="currentColor" stroke-width="2"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>' +
      '</button>' +
      '<button type="button" class="floor-action-btn reply-btn" data-action="toggle-replies" title="Reply">' +
        '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>' +
        (post.replyCount ? '<span>' + post.replyCount + '</span>' : '') +
      '</button>' +
    '</div>' +
    '<div class="floor-replies" id="replies-' + post.id + '">' +
      '<div class="floor-reply-list"></div>' +
      '<div class="floor-reply-input-row">' +
        '<input type="text" placeholder="Write a reply…" data-reply-input>' +
        '<button type="button" class="floor-reply-send" data-send-reply>Send</button>' +
      '</div>' +
    '</div>';

  el.querySelectorAll('.floor-tag[data-tag-type="hashtag"]').forEach((tagEl) => {
    tagEl.addEventListener('click', () => { ACTIVE_TAG = tagEl.dataset.tag; renderFeed(); });
  });

  el.querySelector('[data-action="like"]').addEventListener('click', () => toggleReaction(post, 'likedBy'));
  el.querySelector('[data-action="upvote"]').addEventListener('click', () => toggleVote(post, 'up'));
  el.querySelector('[data-action="downvote"]').addEventListener('click', () => toggleVote(post, 'down'));
  el.querySelector('[data-action="bookmark"]').addEventListener('click', () => toggleBookmark(post));
  el.querySelector('[data-action="toggle-replies"]').addEventListener('click', () => toggleReplies(post, el));

  const deleteBtn = el.querySelector('[data-delete-post]');
  if (deleteBtn) deleteBtn.addEventListener('click', () => deletePost(post.id));

  const sendReplyBtn = el.querySelector('[data-send-reply]');
  const replyInput = el.querySelector('[data-reply-input]');
  sendReplyBtn.addEventListener('click', () => sendReply(post, replyInput, el));
  replyInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendReply(post, replyInput, el); });

  return el;
}

/* ---------------- reactions ---------------- */

function toggleReaction(post, field){
  const arr = post[field] || [];
  const has = arr.includes(FLOOR_UID);
  const ref = db.collection('communityPosts').doc(post.id);
  const update = {};
  update[field] = has ? firebase.firestore.FieldValue.arrayRemove(FLOOR_UID) : firebase.firestore.FieldValue.arrayUnion(FLOOR_UID);
  ref.update(update).then(loadPosts).catch((err) => alert('Could not update: ' + (err.message || err)));
}

function toggleVote(post, direction){
  const upField = 'upvotedBy', downField = 'downvotedBy';
  const isUpvoted = (post.upvotedBy || []).includes(FLOOR_UID);
  const isDownvoted = (post.downvotedBy || []).includes(FLOOR_UID);
  const ref = db.collection('communityPosts').doc(post.id);
  const update = {};

  if (direction === 'up') {
    update[upField] = isUpvoted ? firebase.firestore.FieldValue.arrayRemove(FLOOR_UID) : firebase.firestore.FieldValue.arrayUnion(FLOOR_UID);
    if (isDownvoted) update[downField] = firebase.firestore.FieldValue.arrayRemove(FLOOR_UID);
  } else {
    update[downField] = isDownvoted ? firebase.firestore.FieldValue.arrayRemove(FLOOR_UID) : firebase.firestore.FieldValue.arrayUnion(FLOOR_UID);
    if (isUpvoted) update[upField] = firebase.firestore.FieldValue.arrayRemove(FLOOR_UID);
  }
  ref.update(update).then(loadPosts).catch((err) => alert('Could not update: ' + (err.message || err)));
}

function loadBookmarks(){
  return db.collection('students').doc(FLOOR_UID).collection('bookmarks').get().then((snap) => {
    BOOKMARKED_IDS = new Set();
    snap.forEach((doc) => BOOKMARKED_IDS.add(doc.id));
  });
}

function toggleBookmark(post){
  const ref = db.collection('students').doc(FLOOR_UID).collection('bookmarks').doc(post.id);
  const action = BOOKMARKED_IDS.has(post.id)
    ? ref.delete()
    : ref.set({ createdAt: firebase.firestore.FieldValue.serverTimestamp() });
  action.then(() => loadBookmarks()).then(renderFeed).catch((err) => alert('Could not update bookmark: ' + (err.message || err)));
}

/* ---------------- replies ---------------- */

function toggleReplies(post, cardEl){
  const wrap = cardEl.querySelector('.floor-replies');
  const willOpen = !wrap.classList.contains('open');
  wrap.classList.toggle('open', willOpen);
  if (!willOpen) return;

  const listEl = wrap.querySelector('.floor-reply-list');
  showLoadingAnimation(listEl, 'Loading…');
  db.collection('communityPosts').doc(post.id).collection('replies').orderBy('createdAt', 'asc').get()
    .then((snap) => {
      const replies = [];
      snap.forEach((doc) => replies.push(doc.data()));
      return prefetchAuthorData(replies).then(() => replies);
    })
    .then((replies) => {
      listEl.innerHTML = '';
      if (!replies.length) { listEl.innerHTML = '<p style="color:var(--ink-3); font-size:12.5px;">No replies yet.</p>'; return; }
      replies.forEach((r) => {
        const rDate = r.createdAt && r.createdAt.toDate ? r.createdAt.toDate() : null;
        const rEl = document.createElement('div');
        rEl.className = 'floor-reply';
        const replyRoleTag = (typeof roleTagHtml === 'function') ? roleTagHtml(r.authorPlan || (AUTHOR_DATA_CACHE[r.authorUid] && AUTHOR_DATA_CACHE[r.authorUid].plan), { size: 'small' }) : '';
        const replyAvatarHtml = (typeof avatarImgHtml === 'function')
          ? avatarImgHtml(r.authorUid, r.authorName, AUTHOR_DATA_CACHE[r.authorUid], 30)
          : ('<div class="floor-avatar">' + initials(r.authorName) + '</div>');
        rEl.innerHTML =
          replyAvatarHtml +
          '<div class="floor-reply-body">' +
            '<div class="floor-reply-head"><span class="floor-reply-name">' + escapeHtml(r.authorName || 'Trader') + replyRoleTag + '</span>' +
            '<span class="floor-reply-time">' + timeAgo(rDate) + '</span></div>' +
            '<div class="floor-reply-text">' + escapeHtml(r.text) + '</div>' +
          '</div>';
        listEl.appendChild(rEl);
      });
    })
    .catch((err) => { listEl.innerHTML = '<p style="color:var(--ink-3); font-size:12.5px;">Could not load replies: ' + (err.message || err) + '</p>'; });
}

function sendReply(post, inputEl, cardEl){
  const text = inputEl.value.trim();
  if (!text) return;
  inputEl.disabled = true;

  db.collection('communityPosts').doc(post.id).collection('replies').add({
    authorUid: FLOOR_UID, authorName: FLOOR_NAME, authorPlan: FLOOR_PLAN, text,
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  })
    .then(() => db.collection('communityPosts').doc(post.id).update({ replyCount: firebase.firestore.FieldValue.increment(1) }))
    .then(() => {
      inputEl.value = '';
      loadPosts().then(() => {
        const newCardWrap = document.getElementById('replies-' + post.id);
        if (newCardWrap) {
          const replyBtn = newCardWrap.closest('.floor-post').querySelector('[data-action="toggle-replies"]');
          if (replyBtn) replyBtn.click();
        }
      });
    })
    .catch((err) => alert('Could not send reply: ' + (err.message || err)))
    .finally(() => { inputEl.disabled = false; });
}

/* ---------------- posting ---------------- */

function deletePost(postId){
  if (!confirm('Delete this post?')) return;
  db.collection('communityPosts').doc(postId).delete().then(loadPosts).catch((err) => alert('Could not delete: ' + (err.message || err)));
}

function loadPosts(){
  return db.collection('communityPosts').orderBy('createdAt', 'desc').limit(100).get().then((snap) => {
    ALL_POSTS = [];
    snap.forEach((doc) => ALL_POSTS.push(Object.assign({ id: doc.id }, doc.data())));
    renderFeed();
  }).catch((err) => {
    console.error('Stryker: failed to load posts', err);
    document.getElementById('floor-list').innerHTML =
      '<p style="color:var(--ink-3); font-size:13.5px;">Could not load posts: ' + (err.message || err) + '</p>';
  });
}

document.addEventListener('DOMContentLoaded', () => {
  if (!auth) return;
  initRichTextToolbar('floor-rte-toolbar', 'floor-post-text');

  let handled = false;
  auth.onAuthStateChanged((user) => {
    if (handled) return;
    if (!user) {
      setTimeout(() => { if (!handled) goToLoginPreservingReturn(); }, 1500);
      return;
    }
    handled = true;
    FLOOR_UID = user.uid;
    FLOOR_NAME = user.displayName || (user.email ? user.email.split('@')[0] : 'Trader');
    const planLookup = (typeof db !== 'undefined' && db)
      ? db.collection('students').doc(user.uid).get().then((doc) => { FLOOR_PLAN = doc.exists ? (doc.data().plan || null) : null; }).catch(() => {})
      : Promise.resolve();
    const rolesLookup = (typeof loadPlansForRoles === 'function') ? loadPlansForRoles() : Promise.resolve();
    Promise.all([planLookup, rolesLookup]).then(() => {
      loadBookmarks().then(loadPosts).catch((err) => console.error('Stryker: init failed', err));
      renderFloorLeaderboardWidget(user.uid);
    });
  });

  document.querySelectorAll('#floor-filter-tabs .level-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#floor-filter-tabs .level-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      CURRENT_SORT = btn.dataset.sort;
      renderFeed();
    });
  });

  document.getElementById('floor-image-btn').addEventListener('click', () => {
    document.getElementById('floor-image-input').click();
  });
  document.getElementById('floor-image-input').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    resizeImageToDataUrl(file, 640, 'image/jpeg').then((dataUrl) => {
      PENDING_IMAGE_DATA_URL = dataUrl;
      document.getElementById('floor-image-preview').src = dataUrl;
      document.getElementById('floor-image-preview-wrap').style.display = 'block';
    }).catch((err) => alert('Could not use that image: ' + (err.message || err)));
  });
  document.getElementById('floor-image-remove').addEventListener('click', () => {
    PENDING_IMAGE_DATA_URL = null;
    document.getElementById('floor-image-input').value = '';
    document.getElementById('floor-image-preview-wrap').style.display = 'none';
  });

  document.getElementById('floor-post-btn').addEventListener('click', () => {
    const errEl = document.getElementById('floor-error');
    errEl.style.display = 'none';
    if (!FLOOR_UID) return;

    const editable = document.getElementById('floor-post-text');
    const rawHtml = editable.innerHTML.trim();
    const plainCheck = editable.textContent.trim();
    if (!plainCheck && !PENDING_IMAGE_DATA_URL) {
      errEl.textContent = 'Write something or add an image before posting.';
      errEl.style.display = 'block';
      return;
    }

    const btn = document.getElementById('floor-post-btn');
    btn.disabled = true;

    db.collection('communityPosts').add({
      authorUid: FLOOR_UID,
      authorName: FLOOR_NAME,
      authorPlan: FLOOR_PLAN,
      textHtml: linkifyTags(rawHtml),
      imageDataUrl: PENDING_IMAGE_DATA_URL || null,
      likedBy: [], upvotedBy: [], downvotedBy: [], replyCount: 0,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    }).then(() => {
      editable.innerHTML = '';
      PENDING_IMAGE_DATA_URL = null;
      document.getElementById('floor-image-input').value = '';
      document.getElementById('floor-image-preview-wrap').style.display = 'none';
      loadPosts();
    }).catch((err) => {
      errEl.textContent = err.message || 'Could not post.';
      errEl.style.display = 'block';
    }).finally(() => { btn.disabled = false; });
  });
});

// Small leaderboard widget in the trading floor sidebar — top 5 by invite
// points, reusing the same referral module used on the Invite & Earn page.
function renderFloorLeaderboardWidget(myUid){
  const wrap = document.getElementById('floor-leaderboard-widget');
  if (!wrap || typeof loadReferralLeaderboard !== 'function') return;

  loadReferralLeaderboard(5).then((list) => {
    if (!list.length) {
      wrap.innerHTML = '<p style="color:var(--ink-3); font-size:12.5px;">No invite points yet — be the first to invite someone.</p>';
      return;
    }
    wrap.innerHTML = '';
    list.forEach((entry, i) => {
      const isMe = entry.uid === myUid;
      const roleTag = (typeof roleTagHtml === 'function') ? roleTagHtml(entry.plan, { size: 'small' }) : '';
      const avatarHtml = (typeof avatarImgHtml === 'function') ? avatarImgHtml(entry.uid, entry.name, entry, 22) : '';
      const row = document.createElement('div');
      row.style.cssText = 'display:flex; align-items:center; justify-content:space-between; gap:8px; padding:8px 0; border-bottom:1px solid var(--line-soft);';
      row.innerHTML =
        '<div style="display:flex; align-items:center; gap:8px; min-width:0;">' +
          '<span style="font-family:var(--font-mono); font-size:12px; color:var(--ink-3); flex-shrink:0;">#' + (i + 1) + '</span>' +
          avatarHtml +
          '<span style="font-size:12.5px; color:var(--ink-0); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">' + escapeHtml(entry.name) + (isMe ? ' (you)' : '') + '</span>' +
          roleTag +
        '</div>' +
        '<span style="font-family:var(--font-mono); font-size:12px; color:#f5c542; font-weight:700; flex-shrink:0;">' + entry.points + '</span>';
      wrap.appendChild(row);
    });
  }).catch((err) => {
    console.error('Stryker: floor leaderboard widget failed to load', err);
    wrap.innerHTML = '<p style="color:var(--ink-3); font-size:12.5px;">Could not load leaderboard.</p>';
  });
}
