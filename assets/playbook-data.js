// Stryker Trading Academy — Playbook: data layer
// Depends on: assets/progress.js (`db`), assets/models-store.js (loadModels)
//
// Storage: students/{uid}/journal/_playbooks — one reserved document in the
// journal subcollection, the same trick _settings and _propfirms already use.
// The existing rule for that subcollection covers it, so this ships without a
// single new Firestore rule, and one document means one read on page load.
// loadAllTrades() already skips any document whose id starts with "_", so this
// cannot be mistaken for a trade.
//
// Shape:
//   { playbooks: [{
//       id, name, source, sourceModelId, market, timeframe, direction,
//       sessions: [..], status, colour, targetRR, maxRiskPct, notes,
//       rules: [{ id, text, detail }],
//       createdAt, updatedAt
//     }], updatedAt }
//
// The link to a trade lives on the TRADE, not here: journal trades carry
// `playbookId` and `rulesMet` (an array of rule ids ticked at logging time).
// That keeps a playbook's history intact when its rules are later edited — an
// old trade still records which rules it actually met, by id.

const PLAYBOOK_DOC_ID = '_playbooks';

const PB_STATUS = {
  testing: { label: 'Testing', colour: '#f5c542', help: 'Gathering data. Trade it small.' },
  active:  { label: 'Active',  colour: '#03c988', help: 'Proven enough to trade at full size.' },
  paused:  { label: 'Paused',  colour: '#8b93a0', help: 'Not currently trading this.' },
  retired: { label: 'Retired', colour: '#e5484d', help: 'Kept for the record. No longer traded.' }
};

// Distinct enough to tell apart on a chart, and all readable on both themes.
// Deliberately the same family as the backtesting module's chart palette.
const PB_COLOURS = ['#03a872', '#3f7fe8', '#b07c0e', '#8b7dd8', '#d1685a', '#4aa3a3'];

function pbNewId(prefix) {
  return (prefix || 'pb') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function pbDefault() {
  return { playbooks: [] };
}

// Strips a taught model's rich step HTML down to the one line a checklist
// needs. The full explanation stays available as `detail`, so the playbook can
// link back to the lesson without duplicating it.
function pbRuleFromStep(step, index) {
  const title = String((step && step.title) || '').trim();
  const desc = String((step && step.desc) || '').trim();
  return {
    id: pbNewId('r'),
    text: title || desc || ('Step ' + (index + 1)),
    detail: title && desc && title !== desc ? desc : ''
  };
}

// Builds a playbook from one of the academy's taught models. The student owns
// the copy from that moment on: editing their rules never touches the model,
// and an admin editing the model never silently rewrites someone's history.
// sourceModelId is kept so the detail page can link back to the lesson.
function pbFromModel(model, colourIndex) {
  const steps = (model && model.steps) || [];
  return {
    id: pbNewId(),
    name: String((model && model.name) || 'Untitled model'),
    source: 'model',
    sourceModelId: (model && model.id) || null,
    market: '',
    timeframe: '',
    direction: 'both',
    sessions: [],
    status: 'testing',
    colour: PB_COLOURS[(colourIndex || 0) % PB_COLOURS.length],
    targetRR: null,
    maxRiskPct: null,
    notes: '',
    rules: steps.map(pbRuleFromStep),
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
}

function pbBlank(colourIndex) {
  return {
    id: pbNewId(),
    name: '',
    source: 'custom',
    sourceModelId: null,
    market: '',
    timeframe: '',
    direction: 'both',
    sessions: [],
    status: 'testing',
    colour: PB_COLOURS[(colourIndex || 0) % PB_COLOURS.length],
    targetRR: null,
    maxRiskPct: null,
    notes: '',
    rules: [],
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
}

function pbCollectionRef(uid) {
  return db.collection('students').doc(uid).collection('journal');
}

function loadPlaybooks(uid) {
  return pbCollectionRef(uid).doc(PLAYBOOK_DOC_ID).get()
    .then((doc) => {
      if (!doc.exists) return pbDefault();
      const d = doc.data() || {};
      return { playbooks: Array.isArray(d.playbooks) ? d.playbooks : [] };
    })
    .catch((err) => {
      console.error('Stryker: could not load playbooks', err);
      return pbDefault();
    });
}

function savePlaybooks(uid, data) {
  const payload = {
    playbooks: (data && data.playbooks) || [],
    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
  };
  return pbCollectionRef(uid).doc(PLAYBOOK_DOC_ID).set(payload);
}

// Groups a flat trade list by playbookId. Trades with no playbook are
// returned under the `_none` key so the UI can offer to file them.
function pbGroupTrades(trades) {
  const map = { _none: [] };
  (trades || []).forEach((t) => {
    const id = t && t.playbookId;
    if (!id) { map._none.push(t); return; }
    (map[id] = map[id] || []).push(t);
  });
  return map;
}

// The academy's models, in a shape the "adopt a model" picker can render.
// Falls back to an empty list rather than throwing when models cannot load,
// because a student can still build a custom playbook without them.
function pbLoadAdoptableModels() {
  if (typeof loadModels !== 'function') return Promise.resolve([]);
  // loadModels can throw synchronously (it touches `db` before returning a
  // promise), so a bare .catch on the result would never see that failure and
  // the picker would break instead of falling back. Wrap the call itself.
  try {
    return Promise.resolve(loadModels())
      .then(() => (typeof MODELS !== 'undefined' && Array.isArray(MODELS) ? MODELS : []))
      .catch(() => (typeof MODELS_SEED !== 'undefined' && Array.isArray(MODELS_SEED) ? MODELS_SEED : []));
  } catch (e) {
    console.error('Stryker: could not load the academy models for the playbook picker', e);
    return Promise.resolve(typeof MODELS_SEED !== 'undefined' && Array.isArray(MODELS_SEED) ? MODELS_SEED : []);
  }
}
