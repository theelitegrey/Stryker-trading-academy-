// Stryker Trading Academy — direct messaging core
// Depends on: assets/progress.js (db), assets/auth.js (auth)
//
// DATA MODEL
//   conversations/{convId}
//     participants     [uidA, uidB]        — array, so array-contains can query
//     participantInfo  { uid: {name, ...} }— denormalised for the thread list
//     lastMessage      string              — preview text
//     lastMessageAt    timestamp           — sorts the list
//     lastSenderUid    string
//     unread           { uid: count }      — per participant
//   conversations/{convId}/messages/{msgId}
//     senderUid, text, createdAt
//
// THE CONVERSATION ID IS DERIVED, NOT RANDOM.
// convIdFor() sorts the two uids and joins them, so the same pair always
// resolves to the same document from either side. With an auto-id, two people
// opening the chat at the same moment would each create a thread and then sit
// in separate rooms messaging into the void — a bug that only shows up under
// exactly the conditions you cannot reproduce on demand.
//
// UNREAD IS A STORED COUNTER, NOT A QUERY.
// Counting unread messages per thread would mean a query per conversation on
// every page load just to draw a badge. The sender increments the recipient's
// counter; opening the thread zeroes your own.

function convIdFor(uidA, uidB){
  return [uidA, uidB].sort().join('__');
}

function otherParticipant(conv, myUid){
  var ps = conv.participants || [];
  for (var i = 0; i < ps.length; i++) {
    if (ps[i] !== myUid) return ps[i];
  }
  return null;
}

function escapeMsgText(s){
  return String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Creates the conversation if it doesn't exist yet. merge:true so calling it
// on an existing thread refreshes the cached names without wiping unread
// counts or the last message.
function ensureConversation(myUid, myName, otherUid, otherName){
  var id = convIdFor(myUid, otherUid);
  var info = {};
  info[myUid] = { name: myName || 'Trader' };
  info[otherUid] = { name: otherName || 'Trader' };

  return db.collection('conversations').doc(id).set({
    participants: [myUid, otherUid].sort(),
    participantInfo: info
  }, { merge: true }).then(function () { return id; });
}

function sendMessage(convId, myUid, otherUid, text){
  var clean = String(text || '').trim();
  if (!clean) return Promise.resolve(null);
  if (clean.length > 2000) clean = clean.slice(0, 2000);

  var convRef = db.collection('conversations').doc(convId);

  return convRef.collection('messages').add({
    senderUid: myUid,
    text: clean,
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  }).then(function () {
    var update = {
      lastMessage: clean.slice(0, 120),
      lastMessageAt: firebase.firestore.FieldValue.serverTimestamp(),
      lastSenderUid: myUid
    };
    // Only the recipient's counter moves. Writing both would clear the
    // sender's own unread from other threads' worth of state.
    update['unread.' + otherUid] = firebase.firestore.FieldValue.increment(1);
    return convRef.update(update);
  });
}

function markConversationRead(convId, myUid){
  var update = {};
  update['unread.' + myUid] = 0;
  return db.collection('conversations').doc(convId).update(update)
    .catch(function (err) { console.warn('Stryker: could not clear unread', err); });
}

// Total unread across every thread, for the header badge.
function loadTotalUnread(myUid){
  if (typeof db === 'undefined' || !db) return Promise.resolve(0);
  return db.collection('conversations')
    .where('participants', 'array-contains', myUid)
    .get()
    .then(function (snap) {
      var total = 0;
      snap.forEach(function (d) {
        var u = (d.data().unread || {})[myUid] || 0;
        total += u;
      });
      return total;
    })
    .catch(function () { return 0; });
}

// Relative time, WhatsApp style: clock today, "Yesterday", then a date.
function messageTimeLabel(ts){
  if (!ts || typeof ts.toDate !== 'function') return '';
  var d = ts.toDate();
  var now = new Date();
  var sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  var yest = new Date(now); yest.setDate(now.getDate() - 1);
  if (d.toDateString() === yest.toDateString()) return 'Yesterday';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
