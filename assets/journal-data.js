// Stryker Trading Academy — Trade Journal: data layer
// Depends on: assets/progress.js (`db`), assets/journal-calc.js
//
// Storage: students/{uid}/journal/{entryId} — the EXACT existing collection
// and security rule already used by the old simple journal, unchanged. No
// new Firestore rule is needed for trades.
//
// Settings live in the SAME subcollection, at a reserved fixed document ID
// (journal/_settings) rather than a new subcollection — this means the
// existing rule (`match /journal/{entryId} { allow read, write: if
// request.auth.uid == studentId; }`) already covers settings too, with zero
// new rules to add. Real trades always get an auto-generated ID via .add(),
// so there's no collision risk with the reserved "_settings" ID. Every
// query that lists trades filters this document out.

const JOURNAL_SETTINGS_DOC_ID = '_settings';

function journalCollectionRef(uid){
  return db.collection('students').doc(uid).collection('journal');
}

function loadJournalSettings(uid){
  return journalCollectionRef(uid).doc(JOURNAL_SETTINGS_DOC_ID).get()
    .then((doc) => {
      if (doc.exists) return Object.assign(journalDefaultSettings(), doc.data());
      // First visit: seed the defaults so they're visible immediately and
      // persisted for next time, without requiring the student to open Settings first.
      const defaults = journalDefaultSettings();
      return journalCollectionRef(uid).doc(JOURNAL_SETTINGS_DOC_ID).set(defaults).then(() => defaults);
    })
    .catch((err) => {
      console.error('Stryker: failed to load journal settings, using in-memory defaults', err);
      return journalDefaultSettings();
    });
}

function saveJournalSettings(uid, settings){
  return journalCollectionRef(uid).doc(JOURNAL_SETTINGS_DOC_ID).set(settings, { merge: true });
}

function loadAllTrades(uid){
  return journalCollectionRef(uid).get()
    .then((snap) => {
      const trades = [];
      snap.forEach((doc) => {
        if (doc.id.charAt(0) === '_') return;   // reserved docs: _settings, _propfirms
        trades.push(Object.assign({ id: doc.id }, doc.data()));
      });
      trades.sort((a, b) => {
        const ak = (a.date || '') + 'T' + (a.time || '00:00');
        const bk = (b.date || '') + 'T' + (b.time || '00:00');
        return bk.localeCompare(ak); // newest first
      });
      return trades;
    });
}

// rawTrade: the form's raw field values (strings/numbers as typed). This
// computes and stores the derived fields (pnl, riskAmount, etc.) alongside
// the raw inputs, using the account balance AT SAVE TIME — editing the
// account balance later in Settings does not retroactively change historical
// risk% figures, which is the correct behavior for a real journal record.
function saveTrade(uid, rawTrade, accountBalance, existingId){
  const derived = journalComputeDerived(rawTrade, accountBalance);
  const data = Object.assign({}, rawTrade, derived, {
    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
  });
  if (!existingId) data.createdAt = firebase.firestore.FieldValue.serverTimestamp();

  const ref = existingId ? journalCollectionRef(uid).doc(existingId) : journalCollectionRef(uid).doc();
  return ref.set(data, { merge: !!existingId }).then(() => {
    // Self-incrementing counters for the journal achievement badges — only
    // bump the entry count on a genuinely NEW trade, not an edit to an
    // existing one. hasWinningTrade is a one-way flag: once true, it stays
    // true even if this specific trade is later edited to remove the win.
    const counterUpdate = {};
    if (!existingId) counterUpdate.journalEntryCount = firebase.firestore.FieldValue.increment(1);
    if (derived.pnl > 0) counterUpdate.hasWinningTrade = true;
    if (Object.keys(counterUpdate).length) {
      db.collection('students').doc(uid).set(counterUpdate, { merge: true }).then(() => {
        if (typeof checkAndNotifyNewAchievementsFor === 'function') checkAndNotifyNewAchievementsFor(uid);
      }).catch((err) => console.error('Stryker: failed to update journal counters', err));
    }
    return ref.id;
  });
}

function deleteTrade(uid, tradeId){
  return journalCollectionRef(uid).doc(tradeId).delete();
}
