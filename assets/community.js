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
let FLOOR_IS_MODERATOR = false; // separate from plan entirely — see assets/moderator-team.js
let ALL_POSTS = [];
let CURRENT_SORT = 'new';
let ACTIVE_TAG = null;
let CURRENT_CATEGORY = 'general'; // 'general' | 'propfirm' — which tab is showing
let ACTIVE_FLAIR_FILTER = null;   // null | 'setup' | 'question'
let PENDING_IMAGE_DATA_URL = null;
let PENDING_FLAIR = null;         // null | 'setup' | 'question' — set from the composer's flair picker
let EDITING_POST_ID = null;       // null when composing a new post; set to a post's id while editing it
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
        resolve(canvas.toDataURL(mimeType || 'image/jpeg', 0.87));
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
  list = list.filter(p => !p.hidden); // moderated posts never show in the normal feed — only in the admin review queue
  list = list.filter(p => (p.category || 'general') === CURRENT_CATEGORY);
  if (ACTIVE_FLAIR_FILTER) list = list.filter(p => p.flair === ACTIVE_FLAIR_FILTER);
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

  const feedEl = document.getElementById('floor-list');
  if (!list.length) {
    let emptyMsg = 'No posts yet — be the first to share something with the floor.';
    if (ACTIVE_TAG) emptyMsg = 'No posts match that tag.';
    else if (ACTIVE_FLAIR_FILTER) emptyMsg = 'No ' + ACTIVE_FLAIR_FILTER + ' posts yet.';
    else if (CURRENT_CATEGORY === 'propfirm') emptyMsg = 'No prop firm posts yet — be the first to share something here.';
    feedEl.innerHTML = '<p style="color:var(--ink-3); font-size:13.5px;">' + emptyMsg + '</p>';
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
  // Separate from the role tag entirely — moderator is not a plan, it's
  // an additional capability layered on top of whatever plan someone
  // already has (see assets/moderator-team.js). A shield, not a pill, so
  // it doesn't get visually confused with plan-tier badges like ELITE.
  const isAuthorModerator = (typeof CURRENT_MODERATOR_UIDS !== 'undefined') && CURRENT_MODERATOR_UIDS.has(post.authorUid);
  const shieldBadge = isAuthorModerator
    ? '<span class="floor-mod-shield" title="Moderator"><svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M12 1.5l8.5 3.8v6.2c0 5.3-3.7 9-8.5 10.5-4.8-1.5-8.5-5.2-8.5-10.5V5.3z"/><path d="M10.6 15.4l-3-3 1.3-1.3 1.7 1.7 4.4-4.4 1.3 1.3z" fill="#04121b"/></svg></span>'
    : '';
  // Deliberately a flat text label, not a bordered pill like the role tag —
  // this is post metadata (what kind of post), not identity metadata (who
  // posted), and shouldn't visually compete with the role tag for
  // attention. Sits on the timestamp row instead of the name row for the
  // same reason — grouped with other "about this post" info, not "about
  // this person" info.
  const flairLabel = post.flair
    ? '<span class="floor-flair-label">' + (post.flair === 'setup' ? 'Setup' : 'Question') + '</span>'
    : '';
  const editedLabel = post.editedAt ? '<span class="floor-post-edited">· edited</span>' : '';
  const avatarHtml = (typeof avatarImgHtml === 'function')
    ? avatarImgHtml(post.authorUid, post.authorName, AUTHOR_DATA_CACHE[post.authorUid], 36, true)
    : ('<div class="floor-avatar">' + initials(post.authorName) + '</div>');
  const isOwnPost = post.authorUid === FLOOR_UID;
  const canModerate = !isOwnPost && FLOOR_IS_MODERATOR;
  el.innerHTML =
    '<div class="floor-post-head">' +
      avatarHtml +
      '<div><div class="floor-post-name">' + escapeHtml(post.authorName || 'Trader') + roleTag + shieldBadge + '</div>' +
      '<div class="floor-post-time">' + timeAgo(createdDate) + editedLabel + flairLabel + '</div></div>' +
      (isOwnPost
        ? '<div class="floor-post-menu-wrap">' +
            '<button type="button" class="icon-btn" data-post-menu-toggle title="More"><svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" stroke="none"><circle cx="12" cy="5" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="12" cy="19" r="1.8"/></svg></button>' +
            '<div class="floor-post-menu" data-post-menu style="display:none;">' +
              '<button type="button" data-edit-post>Edit</button>' +
              '<button type="button" data-delete-post>Delete</button>' +
            '</div>' +
          '</div>'
        : canModerate
        ? '<div class="floor-post-menu-wrap">' +
            '<button type="button" class="icon-btn" data-post-menu-toggle title="Moderator actions"><svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" stroke="none"><circle cx="12" cy="5" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="12" cy="19" r="1.8"/></svg></button>' +
            '<div class="floor-post-menu" data-post-menu style="display:none;">' +
              '<button type="button" data-moderate-post style="color:var(--bear);">Hide &amp; send for review</button>' +
            '</div>' +
          '</div>'
        : '') +
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

  const menuToggleBtn = el.querySelector('[data-post-menu-toggle]');
  const menuDropdown = el.querySelector('[data-post-menu]');
  if (menuToggleBtn && menuDropdown) {
    menuToggleBtn.addEventListener('click', (e) => {
      e.stopPropagation(); // don't let this same click immediately re-trigger the "click outside" listener below
      const isOpen = menuDropdown.style.display === 'block';
      document.querySelectorAll('.floor-post-menu').forEach(m => m.style.display = 'none'); // only one post's menu open at a time
      menuDropdown.style.display = isOpen ? 'none' : 'block';
    });
  }

  const deleteBtn = el.querySelector('[data-delete-post]');
  if (deleteBtn) deleteBtn.addEventListener('click', () => {
    if (menuDropdown) menuDropdown.style.display = 'none';
    deletePost(post.id);
  });

  const editBtn = el.querySelector('[data-edit-post]');
  if (editBtn) editBtn.addEventListener('click', () => {
    if (menuDropdown) menuDropdown.style.display = 'none';
    openComposerModal(post);
  });

  const moderateBtn = el.querySelector('[data-moderate-post]');
  if (moderateBtn) moderateBtn.addEventListener('click', () => {
    if (menuDropdown) menuDropdown.style.display = 'none';
    moderatePost(post);
  });

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
  ref.update(update).then(() => {
    if (field !== 'likedBy') return;
    // This writes to the POST AUTHOR's doc, not the liker's — the like-
    // count achievement belongs to whoever received the like. Needs a
    // narrow Firestore rule exception (see the floorLikesReceived-only
    // update clause) since a student can otherwise only write their own doc.
    const delta = has ? -1 : 1;
    db.collection('students').doc(post.authorUid).set({
      floorLikesReceived: firebase.firestore.FieldValue.increment(delta)
    }, { merge: true }).then(() => {
      if (typeof checkAndNotifyNewAchievementsFor === 'function') checkAndNotifyNewAchievementsFor(post.authorUid, false);
    }).catch((err) => console.error('Stryker: failed to update likes-received count', err));
    // Only notify on a genuine new like (not un-liking), and never for
    // liking your own post.
    if (!has && post.authorUid !== FLOOR_UID && typeof createNotification === 'function') {
      createNotification(post.authorUid, 'like', FLOOR_NAME + ' liked your post.', 'trading-floor.html');
    }
  }).then(loadPosts).catch((err) => alert('Could not update: ' + (err.message || err)));
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
          ? avatarImgHtml(r.authorUid, r.authorName, AUTHOR_DATA_CACHE[r.authorUid], 30, true)
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
      if (post.authorUid !== FLOOR_UID && typeof createNotification === 'function') {
        createNotification(post.authorUid, 'reply', FLOOR_NAME + ' replied to your post.', 'trading-floor.html');
      }
      // Self-incrementing counter, same reasoning as the post counter above.
      db.collection('students').doc(FLOOR_UID).set({
        floorReplyCount: firebase.firestore.FieldValue.increment(1)
      }, { merge: true }).then(() => {
        if (typeof checkAndNotifyNewAchievementsFor === 'function') checkAndNotifyNewAchievementsFor(FLOOR_UID, true);
      }).catch((err) => console.error('Stryker: failed to update reply count', err));
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

// Moderator action — hides a post from the normal feed and flags it for
// admin review, rather than deleting it outright. Only a moderator (never
// the post's own author, see canModerate in renderPostCard) can reach
// this. A written reason is required: it's stored on the post and shown
// to the author and to the admin who reviews it, so no one is left
// guessing why their content disappeared.
let PENDING_MODERATION_POST = null;

function moderatePost(post){
  PENDING_MODERATION_POST = post;
  const overlay = document.getElementById('floor-moderate-modal-overlay');
  const reasonEl = document.getElementById('floor-moderate-reason');
  const errEl = document.getElementById('floor-moderate-error');
  if (errEl) errEl.style.display = 'none';
  if (reasonEl) reasonEl.value = '';
  if (overlay) overlay.style.display = 'flex';
  if (reasonEl) reasonEl.focus();
}

function closeModerateModal(){
  const overlay = document.getElementById('floor-moderate-modal-overlay');
  if (overlay) overlay.style.display = 'none';
  PENDING_MODERATION_POST = null;
}

function submitModeration(){
  const post = PENDING_MODERATION_POST;
  if (!post) return;
  const reasonEl = document.getElementById('floor-moderate-reason');
  const errEl = document.getElementById('floor-moderate-error');
  const confirmBtn = document.getElementById('floor-moderate-confirm-btn');
  const reason = (reasonEl && reasonEl.value || '').trim();

  if (!reason) {
    if (errEl) { errEl.textContent = 'Please write a reason before sending this for review.'; errEl.style.display = 'block'; }
    return;
  }
  if (errEl) errEl.style.display = 'none';
  if (confirmBtn) confirmBtn.disabled = true;

  db.collection('communityPosts').doc(post.id).update({
    hidden: true,
    moderatedBy: FLOOR_UID,
    moderatedByName: FLOOR_NAME,
    moderationReason: reason,
    moderatedAt: firebase.firestore.FieldValue.serverTimestamp()
  }).then(() => {
    if (typeof createNotification === 'function') {
      if (post.authorUid !== FLOOR_UID) {
        createNotification(post.authorUid, 'post_moderated', 'A moderator hid one of your posts for review. Reason: ' + reason, 'trading-floor.html');
      }
      db.collection('admins').get().then((snap) => {
        snap.forEach((doc) => {
          if (doc.id !== FLOOR_UID) {
            createNotification(doc.id, 'moderation_review', FLOOR_NAME + ' sent a post for review. Reason: ' + reason, 'moderation-admin.html');
          }
        });
      }).catch((err) => console.error('Stryker: failed to notify admins of moderated post', err));
    }
    closeModerateModal();
    loadPosts();
  }).catch((err) => {
    if (errEl) { errEl.textContent = err.message || 'Could not moderate post.'; errEl.style.display = 'block'; }
  }).finally(() => { if (confirmBtn) confirmBtn.disabled = false; });
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

  // Lightbox — event delegation on #floor-list since posts re-render on
  // every load, rather than re-attaching a listener to every image each time.
  const lightboxOverlay = document.getElementById('floor-lightbox-overlay');
  const lightboxImg = document.getElementById('floor-lightbox-img');
  function closeLightbox(){ if (lightboxOverlay) lightboxOverlay.style.display = 'none'; }
  const floorList = document.getElementById('floor-list');
  if (floorList && lightboxOverlay && lightboxImg) {
    floorList.addEventListener('click', (e) => {
      const img = e.target.closest('.floor-post-image');
      if (!img) return;
      lightboxImg.src = img.src;
      lightboxOverlay.style.display = 'flex';
    });
  }
  if (lightboxOverlay) {
    lightboxOverlay.addEventListener('click', (e) => {
      if (e.target === lightboxOverlay) closeLightbox(); // backdrop only, not the image itself
    });
  }
  const lightboxCloseBtn = document.getElementById('floor-lightbox-close');
  if (lightboxCloseBtn) lightboxCloseBtn.addEventListener('click', closeLightbox);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && lightboxOverlay && lightboxOverlay.style.display !== 'none') closeLightbox();
  });

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
    const moderatorListLookup = (typeof loadModeratorList === 'function') ? loadModeratorList() : Promise.resolve();
    const rolesLookup = (typeof loadPlansForRoles === 'function') ? loadPlansForRoles() : Promise.resolve();
    Promise.all([planLookup, moderatorListLookup, rolesLookup]).then(() => {
      // Derived from the same collection-wide load rather than a second,
      // redundant single-doc query for the same information.
      FLOOR_IS_MODERATOR = (typeof CURRENT_MODERATOR_UIDS !== 'undefined') && CURRENT_MODERATOR_UIDS.has(user.uid);
      loadBookmarks().then(loadPosts).catch((err) => console.error('Stryker: init failed', err));
      renderFloorLeaderboardWidget(user.uid);
    });
  });

  document.querySelectorAll('#floor-filter-tabs [data-sort]').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#floor-filter-tabs [data-sort]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      CURRENT_SORT = btn.dataset.sort;
      renderFeed();
    });
  });

  // Flair filter pills toggle on/off — clicking the already-active one
  // clears the filter, rather than requiring a separate "all" option.
  document.querySelectorAll('#floor-filter-tabs [data-flair]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const isActive = btn.classList.contains('active');
      document.querySelectorAll('#floor-filter-tabs [data-flair]').forEach(b => b.classList.remove('active'));
      ACTIVE_FLAIR_FILTER = isActive ? null : btn.dataset.flair;
      if (!isActive) btn.classList.add('active');
      renderFeed();
    });
  });

  document.querySelectorAll('#floor-category-tabs [data-category]').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#floor-category-tabs [data-category]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      CURRENT_CATEGORY = btn.dataset.category;
      renderFeed();
      // The tweets panel only makes sense under the prop firm tab — hide
      // it entirely under Posts, and fetch on first switch to prop firm
      // (loadPropFirmTweets no-ops on subsequent switches, already cached).
      const tweetsPanel = document.getElementById('floor-propfirm-tweets-panel');
      if (CURRENT_CATEGORY === 'propfirm') {
        if (tweetsPanel) tweetsPanel.style.display = 'block';
        if (typeof loadPropFirmTweets === 'function') loadPropFirmTweets();
      } else if (tweetsPanel) {
        tweetsPanel.style.display = 'none';
      }
    });
  });

  // Composer flair picker — same toggle-on/off behavior as the filter pills.
  document.querySelectorAll('#floor-flair-picker [data-flair]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const isSelected = btn.classList.contains('selected');
      document.querySelectorAll('#floor-flair-picker [data-flair]').forEach(b => b.classList.remove('selected'));
      PENDING_FLAIR = isSelected ? null : btn.dataset.flair;
      if (!isSelected) btn.classList.add('selected');
    });
  });

  document.getElementById('floor-image-btn').addEventListener('click', () => {
    document.getElementById('floor-image-input').click();
  });
  document.getElementById('floor-image-input').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    resizeImageToDataUrl(file, 1280, 'image/jpeg').then((dataUrl) => {
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

  // Floating "New post" button → opens the composer modal. Closes on the
  // × button, clicking the dark overlay itself, or Escape.
  // Also doubles as the edit flow: called with a post object (from an
  // Edit button elsewhere in this file) it pre-fills everything and
  // switches save behavior to update that post instead of creating a new
  // one. Exposed on window since renderPostCard, which needs to call this
  // for the Edit button, is a top-level function outside this closure.
  const composerOverlay = document.getElementById('floor-composer-modal-overlay');
  function openComposerModal(postToEdit){
    if (composerOverlay) composerOverlay.style.display = 'flex';
    const editable = document.getElementById('floor-post-text');
    const titleEl = document.getElementById('floor-composer-title');
    const postBtnLabel = document.getElementById('floor-post-btn-label');

    EDITING_POST_ID = postToEdit ? postToEdit.id : null;

    document.querySelectorAll('#floor-flair-picker [data-flair]').forEach(b => b.classList.remove('selected'));

    if (postToEdit) {
      if (titleEl) titleEl.textContent = 'Edit post';
      if (postBtnLabel) postBtnLabel.textContent = 'Save changes';
      if (editable) editable.innerHTML = postToEdit.textHtml || '';
      PENDING_FLAIR = postToEdit.flair || null;
      if (PENDING_FLAIR) {
        const btn = document.querySelector('#floor-flair-picker [data-flair="' + PENDING_FLAIR + '"]');
        if (btn) btn.classList.add('selected');
      }
      PENDING_IMAGE_DATA_URL = postToEdit.imageDataUrl || null;
      const previewWrap = document.getElementById('floor-image-preview-wrap');
      const previewImg = document.getElementById('floor-image-preview');
      if (PENDING_IMAGE_DATA_URL && previewWrap && previewImg) {
        previewImg.src = PENDING_IMAGE_DATA_URL;
        previewWrap.style.display = 'block';
      }
    } else {
      // Fresh post — reset everything rather than carrying over state
      // from a previous post (whether a prior edit or a prior new post).
      PENDING_FLAIR = null;
      PENDING_IMAGE_DATA_URL = null;
      if (editable) editable.innerHTML = '';
      const previewWrap = document.getElementById('floor-image-preview-wrap');
      if (previewWrap) previewWrap.style.display = 'none';
      const imageInput = document.getElementById('floor-image-input');
      if (imageInput) imageInput.value = '';
      if (titleEl) titleEl.textContent = CURRENT_CATEGORY === 'propfirm' ? 'New prop firm post' : 'New post';
      if (postBtnLabel) postBtnLabel.textContent = 'Post';
    }

    if (editable) {
      editable.setAttribute('data-placeholder', CURRENT_CATEGORY === 'propfirm'
        ? 'A challenge you\'re running, a payout, a question about a firm\'s rules… Use @name to mention someone, #tag to label a topic.'
        : 'Daily bias, a setup you\'re watching, a question… Use @name to mention someone, #tag to label a topic.');
      editable.focus();
    }
  }
  window.openComposerModal = openComposerModal;
  function closeComposerModal(){
    if (composerOverlay) composerOverlay.style.display = 'none';
  }
  const fabBtn = document.getElementById('floor-fab-btn');
  if (fabBtn) fabBtn.addEventListener('click', () => openComposerModal());
  const composerCloseBtn = document.getElementById('floor-composer-close-btn');
  if (composerCloseBtn) composerCloseBtn.addEventListener('click', closeComposerModal);
  if (composerOverlay) {
    composerOverlay.addEventListener('click', (e) => {
      if (e.target === composerOverlay) closeComposerModal(); // click on the dark backdrop, not the card itself
    });
  }
  // Moderation reason modal — confirm, cancel, backdrop click, Escape.
  const moderateConfirmBtn = document.getElementById('floor-moderate-confirm-btn');
  if (moderateConfirmBtn) moderateConfirmBtn.addEventListener('click', submitModeration);
  const moderateCancelBtn = document.getElementById('floor-moderate-cancel-btn');
  if (moderateCancelBtn) moderateCancelBtn.addEventListener('click', closeModerateModal);
  const moderateCloseBtn = document.getElementById('floor-moderate-close-btn');
  if (moderateCloseBtn) moderateCloseBtn.addEventListener('click', closeModerateModal);
  const moderateOverlay = document.getElementById('floor-moderate-modal-overlay');
  if (moderateOverlay) {
    moderateOverlay.addEventListener('click', (e) => {
      if (e.target === moderateOverlay) closeModerateModal();
    });
  }
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && moderateOverlay && moderateOverlay.style.display !== 'none') closeModerateModal();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && composerOverlay && composerOverlay.style.display !== 'none') closeComposerModal();
  });

  // Closes any open post's ⋮ menu when clicking anywhere outside it — one
  // listener here handles every post's menu, rather than attaching a new
  // one per post on every render.
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.floor-post-menu-wrap')) {
      document.querySelectorAll('.floor-post-menu').forEach(m => m.style.display = 'none');
    }
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

    function resetComposerAfterSave(){
      editable.innerHTML = '';
      PENDING_IMAGE_DATA_URL = null;
      PENDING_FLAIR = null;
      EDITING_POST_ID = null;
      document.getElementById('floor-image-input').value = '';
      document.getElementById('floor-image-preview-wrap').style.display = 'none';
      closeComposerModal();
      loadPosts();
    }

    if (EDITING_POST_ID) {
      // Editing an existing post — only the content fields change.
      // authorUid, category, createdAt, and all the reaction arrays stay
      // exactly as they were; this only ever needs to touch what the
      // edit rule actually allows (see the Firestore rule this feature
      // needs, given separately).
      db.collection('communityPosts').doc(EDITING_POST_ID).update({
        textHtml: linkifyTags(rawHtml),
        imageDataUrl: PENDING_IMAGE_DATA_URL || null,
        flair: PENDING_FLAIR || null,
        editedAt: firebase.firestore.FieldValue.serverTimestamp()
      }).then(resetComposerAfterSave).catch((err) => {
        errEl.textContent = err.message || 'Could not save changes.';
        errEl.style.display = 'block';
      }).finally(() => { btn.disabled = false; });
      return;
    }

    db.collection('communityPosts').add({
      authorUid: FLOOR_UID,
      authorName: FLOOR_NAME,
      authorPlan: FLOOR_PLAN,
      textHtml: linkifyTags(rawHtml),
      imageDataUrl: PENDING_IMAGE_DATA_URL || null,
      category: CURRENT_CATEGORY,
      flair: PENDING_FLAIR || null,
      likedBy: [], upvotedBy: [], downvotedBy: [], replyCount: 0,
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    }).then(() => {
      // Self-incrementing counter — this is the poster updating their own
      // doc, no cross-user permission needed. Powers the post-count
      // achievement badges without requiring a query every time they're checked.
      db.collection('students').doc(FLOOR_UID).set({
        floorPostCount: firebase.firestore.FieldValue.increment(1)
      }, { merge: true }).then(() => {
        if (typeof checkAndNotifyNewAchievementsFor === 'function') checkAndNotifyNewAchievementsFor(FLOOR_UID, true);
      }).catch((err) => console.error('Stryker: failed to update post count', err));
      resetComposerAfterSave();
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
      const avatarHtml = (typeof avatarImgHtml === 'function') ? avatarImgHtml(entry.uid, entry.name, entry, 22, true) : '';
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
