// Stryker Trading Academy — Messages page (messages.html)
// Depends on: assets/messages.js, assets/auth.js, assets/progress.js,
//             assets/avatars.js, assets/roles.js
//
// Two panes: a thread list and an open conversation. On desktop both are
// visible; on mobile the thread slides over the list, because a 380px screen
// split in two gives neither pane enough room to be usable.
//
// Both panes are LIVE via onSnapshot rather than polled. A chat that updates
// on refresh is not a chat — and a listener is also cheaper than repeatedly
// re-querying, since Firestore only bills the documents that actually change.

var MSG_UID = null;
var MSG_NAME = null;
var MSG_ACTIVE_CONV = null;
var MSG_ACTIVE_OTHER = null;
var MSG_UNSUB_THREAD = null;
var MSG_UNSUB_LIST = null;
var MSG_UNSUB_CONV = null;      // the open conversation DOC, for typing
var MSG_UNSUB_PRESENCE = null;
var MSG_PRESENCE = {};          // uid -> presence doc, shared by list and header
var MSG_LAST_CONVS = null;

function renderThreadList(convs){
  var wrap = document.getElementById('msg-thread-list');
  if (!wrap) return;

  if (!convs.length) {
    wrap.innerHTML =
      '<div class="msg-empty">' +
        '<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6">' +
        '<path d="M21 11.5a8.4 8.4 0 0 1-8.5 8.5 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7A8.4 8.4 0 0 1 12.5 3 8.4 8.4 0 0 1 21 11.5z"/></svg>' +
        '<p>No conversations yet.</p>' +
        '<span>Open someone\'s profile from the Trading Floor and press Message.</span>' +
      '</div>';
    return;
  }

  wrap.innerHTML = '';
  convs.forEach(function (c) {
    var otherUid = otherParticipant(c, MSG_UID);
    var info = (c.participantInfo || {})[otherUid] || {};
    var name = info.name || 'Trader';
    var unread = (c.unread || {})[MSG_UID] || 0;
    var mine = c.lastSenderUid === MSG_UID;

    var row = document.createElement('button');
    row.type = 'button';
    row.className = 'msg-thread' + (c.id === MSG_ACTIVE_CONV ? ' active' : '') + (unread ? ' has-unread' : '');
    row.innerHTML =
      '<span class="msg-avatar-wrap' + (presenceIsOnline(MSG_PRESENCE[otherUid]) ? ' online' : '') + '">' +
        (typeof avatarImgHtml === 'function' ? avatarImgHtml(otherUid, name, info, 44) : '<div class="floor-avatar" style="width:44px;height:44px;"></div>') +
      '</span>' +
      '<div class="msg-thread-body">' +
        '<div class="msg-thread-top">' +
          '<span class="msg-thread-name">' + escapeMsgText(name) + '</span>' +
          '<span class="msg-thread-time">' + messageTimeLabel(c.lastMessageAt) + '</span>' +
        '</div>' +
        '<div class="msg-thread-bottom">' +
          '<span class="msg-thread-preview">' +
            (mine ? '<span class="msg-you">You: </span>' : '') +
            escapeMsgText(c.lastMessage || 'No messages yet') +
          '</span>' +
          (unread ? '<span class="msg-thread-badge">' + (unread > 99 ? '99+' : unread) + '</span>' : '') +
        '</div>' +
      '</div>';

    row.addEventListener('click', function () { openConversation(c.id, otherUid, name, info); });
    wrap.appendChild(row);
  });
}

function renderMessages(msgs){
  var wrap = document.getElementById('msg-bubbles');
  if (!wrap) return;

  if (!msgs.length) {
    wrap.innerHTML = '<div class="msg-empty" style="padding:40px 20px;"><p>No messages yet.</p><span>Say hello.</span></div>';
    return;
  }

  var html = '';
  var lastDay = '';
  msgs.forEach(function (m) {
    // Day separators, so a long thread stays readable rather than becoming an
    // undifferentiated wall of bubbles.
    var d = m.createdAt && m.createdAt.toDate ? m.createdAt.toDate() : null;
    var day = d ? d.toDateString() : '';
    if (d && day !== lastDay) {
      lastDay = day;
      html += '<div class="msg-daysep"><span>' + escapeMsgText(messageTimeLabel(m.createdAt) === 'Yesterday'
        ? 'Yesterday'
        : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })) + '</span></div>';
    }
    var mine = m.senderUid === MSG_UID;
    html +=
      '<div class="msg-row' + (mine ? ' mine' : '') + '">' +
        '<div class="msg-bubble">' +
          '<span class="msg-text">' + escapeMsgText(m.text) + '</span>' +
          '<span class="msg-time">' + (d ? d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : '') + '</span>' +
        '</div>' +
      '</div>';
  });
  wrap.innerHTML = html;
  // Jump to newest. A chat that opens at the top of history is useless.
  wrap.scrollTop = wrap.scrollHeight;
}

function openConversation(convId, otherUid, otherName, otherInfo){
  MSG_ACTIVE_CONV = convId;
  MSG_ACTIVE_OTHER = otherUid;

  var pane = document.getElementById('msg-pane');
  pane.classList.add('open');
  // The pane is a fixed overlay on mobile; without this the page behind it
  // still scrolls under your thumb while you read.
  if (window.matchMedia('(max-width:900px)').matches) document.body.style.overflow = 'hidden';
  document.getElementById('msg-peer-name').textContent = otherName;
  var av = document.getElementById('msg-peer-avatar');
  if (av) {
    av.innerHTML = (typeof avatarImgHtml === 'function')
      ? avatarImgHtml(otherUid, otherName, otherInfo || {}, 36) : '';
  }
  var link = document.getElementById('msg-peer-profile');
  if (link) link.href = 'profile.html?uid=' + encodeURIComponent(otherUid);

  // Detach the previous thread listener before attaching a new one, or every
  // conversation opened would leave a listener running and older threads would
  // keep overwriting the visible one.
  if (MSG_UNSUB_THREAD) { MSG_UNSUB_THREAD(); MSG_UNSUB_THREAD = null; }

  MSG_UNSUB_THREAD = db.collection('conversations').doc(convId)
    .collection('messages').orderBy('createdAt', 'asc').limitToLast(200)
    .onSnapshot(function (snap) {
      var msgs = [];
      snap.forEach(function (d) { msgs.push(d.data()); });
      renderMessages(msgs);
      markConversationRead(convId, MSG_UID);
    }, function (err) {
      console.error('Stryker: message listener failed', err);
      document.getElementById('msg-bubbles').innerHTML =
        '<div class="msg-empty"><p>Could not load this conversation.</p><span>' + escapeMsgText(err.message || err) + '</span></div>';
    });

  // Separate listener on the conversation DOC. The messages subcollection
  // listener above never fires for a typing beat, because typing is stored on
  // the parent document — deliberately, so it does not pollute the message
  // history with rows that are not messages.
  if (MSG_UNSUB_CONV) { MSG_UNSUB_CONV(); MSG_UNSUB_CONV = null; }
  MSG_UNSUB_CONV = db.collection('conversations').doc(convId)
    .onSnapshot(function (doc) {
      if (!doc.exists) return;
      renderTyping(isTyping(doc.data(), otherUid));
    });

  markConversationRead(convId, MSG_UID);
  updatePeerPresence();
  document.getElementById('msg-input').focus();
}

function renderTyping(on){
  var el = document.getElementById('msg-typing');
  if (!el) return;
  el.style.display = on ? 'flex' : 'none';
  if (on) {
    // Keep it in view: an indicator below the fold announces nothing.
    var wrap = document.getElementById('msg-bubbles');
    if (wrap && wrap.scrollHeight - wrap.scrollTop - wrap.clientHeight < 80) {
      wrap.scrollTop = wrap.scrollHeight;
    }
  }
}

function closeConversation(){
  document.getElementById('msg-pane').classList.remove('open');
  document.body.style.overflow = '';
  if (MSG_UNSUB_THREAD) { MSG_UNSUB_THREAD(); MSG_UNSUB_THREAD = null; }
  if (MSG_UNSUB_CONV) { MSG_UNSUB_CONV(); MSG_UNSUB_CONV = null; }
  if (MSG_ACTIVE_CONV) clearTyping(MSG_ACTIVE_CONV, MSG_UID);
  renderTyping(false);
  MSG_ACTIVE_CONV = null;
  MSG_ACTIVE_OTHER = null;
}

function watchThreadList(){
  if (MSG_UNSUB_LIST) MSG_UNSUB_LIST();
  MSG_UNSUB_LIST = db.collection('conversations')
    .where('participants', 'array-contains', MSG_UID)
    .onSnapshot(function (snap) {
      var convs = [];
      snap.forEach(function (d) { convs.push(Object.assign({ id: d.id }, d.data())); });
      // Sorted client-side: ordering by lastMessageAt in the query would need
      // a composite index, and a brand-new thread has an unresolved
      // serverTimestamp that would sort unpredictably anyway.
      MSG_LAST_CONVS = convs;
      convs.sort(function (a, b) {
        var at = a.lastMessageAt && a.lastMessageAt.toMillis ? a.lastMessageAt.toMillis() : 0;
        var bt = b.lastMessageAt && b.lastMessageAt.toMillis ? b.lastMessageAt.toMillis() : 0;
        return bt - at;
      });
      renderThreadList(convs);
      watchPresenceFor(convs);
    }, function (err) {
      console.error('Stryker: conversation list failed', err);
      document.getElementById('msg-thread-list').innerHTML =
        '<div class="msg-empty"><p>Could not load conversations.</p><span>' + escapeMsgText(err.message || err) + '</span></div>';
    });
}

// One listener covering every person in the thread list. Firestore caps an
// 'in' query at 30 values, which is comfortably more conversations than this
// list shows, and one subscription beats one per contact.
var _presenceWatching = '';
function watchPresenceFor(convs){
  var uids = convs.map(function (c) { return otherParticipant(c, MSG_UID); })
                  .filter(Boolean).slice(0, 30);
  if (!uids.length) return;

  var signature = uids.slice().sort().join(',');
  if (signature === _presenceWatching) return;   // same people, keep the listener
  _presenceWatching = signature;

  if (MSG_UNSUB_PRESENCE) MSG_UNSUB_PRESENCE();
  MSG_UNSUB_PRESENCE = db.collection('presence')
    .where(firebase.firestore.FieldPath.documentId(), 'in', uids)
    .onSnapshot(function (snap) {
      MSG_PRESENCE = {};
      snap.forEach(function (d) { MSG_PRESENCE[d.id] = d.data(); });
      // Re-render so dots appear without waiting for the next message.
      if (MSG_LAST_CONVS) renderThreadList(MSG_LAST_CONVS);
      updatePeerPresence();
    }, function (err) {
      console.warn('Stryker: presence unavailable', err);
    });
}

function updatePeerPresence(){
  var el = document.getElementById('msg-peer-status');
  if (!el || !MSG_ACTIVE_OTHER) return;
  var online = presenceIsOnline(MSG_PRESENCE[MSG_ACTIVE_OTHER]);
  el.textContent = online ? 'Online' : '';
  el.className = 'msg-peer-status' + (online ? ' online' : '');
  var wrap = document.getElementById('msg-peer-avatar');
  if (wrap) wrap.className = 'msg-avatar-wrap' + (online ? ' online' : '');
}

function submitMessage(){
  var input = document.getElementById('msg-input');
  var text = input.value.trim();
  if (!text || !MSG_ACTIVE_CONV) return;

  // Cleared immediately rather than on success: the optimistic feel matters
  // more than the rare failure, and onSnapshot will show the real message
  // the moment it lands.
  input.value = '';
  autoGrow(input);
  clearTyping(MSG_ACTIVE_CONV, MSG_UID);

  sendMessage(MSG_ACTIVE_CONV, MSG_UID, MSG_ACTIVE_OTHER, text)
    .then(function () {
      if (typeof createNotification === 'function') {
        createNotification(MSG_ACTIVE_OTHER, 'message',
          MSG_NAME + ' sent you a message.', 'messages.html');
      }
    })
    .catch(function (err) {
      if (typeof showToast === 'function') showToast('error', 'Could not send: ' + (err.message || err));
      input.value = text;   // hand it back rather than losing what they typed
    });
}

function autoGrow(el){
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 120) + 'px';
}

document.addEventListener('DOMContentLoaded', function () {
  if (!document.getElementById('msg-thread-list')) return;

  var input = document.getElementById('msg-input');
  var sendBtn = document.getElementById('msg-send');
  var backBtn = document.getElementById('msg-back');

  if (sendBtn) sendBtn.addEventListener('click', submitMessage);
  if (backBtn) backBtn.addEventListener('click', closeConversation);
  if (input) {
    input.addEventListener('input', function () {
      autoGrow(input);
      if (MSG_ACTIVE_CONV) {
        if (input.value.trim()) signalTyping(MSG_ACTIVE_CONV, MSG_UID);
        else clearTyping(MSG_ACTIVE_CONV, MSG_UID);
      }
    });
    // Emptying the box on blur too: walking away mid-sentence should not leave
    // the other person watching dots indefinitely.
    input.addEventListener('blur', function () {
      if (MSG_ACTIVE_CONV) clearTyping(MSG_ACTIVE_CONV, MSG_UID);
    });
    input.addEventListener('keydown', function (e) {
      // Enter sends, Shift+Enter breaks the line — the convention everywhere.
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitMessage(); }
    });
  }

  var handled = false;
  auth.onAuthStateChanged(function (user) {
    if (handled) return;
    if (!user) { setTimeout(function () { if (!handled) goToLoginPreservingReturn(); }, 1500); return; }
    handled = true;

    MSG_UID = user.uid;
    MSG_NAME = user.displayName || (user.email ? user.email.split('@')[0] : 'Trader');

    watchThreadList();

    // ?to=<uid> opens (or starts) a thread directly — this is what the Message
    // button on a profile links to.
    var target = new URLSearchParams(window.location.search).get('to');
    if (target && target !== MSG_UID) {
      db.collection('profiles').doc(target).get().then(function (doc) {
        var info = doc.exists ? doc.data() : {};
        var name = info.displayName || 'Trader';
        return ensureConversation(MSG_UID, MSG_NAME, target, name).then(function (id) {
          openConversation(id, target, name, info);
        });
      }).catch(function (err) {
        if (typeof showToast === 'function') showToast('error', 'Could not open that conversation.');
        console.error('Stryker: could not start conversation', err);
      });
    }
  });
});

// Listeners are torn down on unload. Without this, navigating away leaves the
// snapshot subscriptions attached to a dead page.
window.addEventListener('beforeunload', function () {
  if (MSG_UNSUB_THREAD) MSG_UNSUB_THREAD();
  if (MSG_UNSUB_LIST) MSG_UNSUB_LIST();
  if (MSG_UNSUB_CONV) MSG_UNSUB_CONV();
  if (MSG_UNSUB_PRESENCE) MSG_UNSUB_PRESENCE();
  if (MSG_ACTIVE_CONV) clearTyping(MSG_ACTIVE_CONV, MSG_UID);
});
