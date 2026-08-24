// Stryker Trading Academy — shared Roles & Access helper
// Depends on: assets/progress.js (`db`)
//
// "Roles" ARE the existing Plans (Starter/Pro/Elite) — this module doesn't
// introduce a new collection. It adds two fields to each plan document:
//   rank:  integer, higher = more access (0 = lowest tier). Used for
//          hierarchical comparison — Elite (rank 2) can see anything
//          gated to Pro (rank 1) or Starter (rank 0).
//   color: hex string, used for the role tag shown next to a user's name.
//
// Content items (chapters, models) store a `minRole` field holding the
// REQUIRED PLAN'S ID. Pages store their requirement centrally in
// `settings/pageAccess`, keyed by a short page key, also holding a plan id.
//
// Everything degrades gracefully: a chapter/model/page with no minRole set
// is treated as open to any signed-in student — access control here is
// opt-in per item, not a default lockout, so nothing breaks for content
// that hasn't been explicitly restricted yet.

let _rolesPlansCache = null;
let _rolesLoadPromise = null;

function loadPlansForRoles(forceRefresh){
  if (_rolesLoadPromise && !forceRefresh) return _rolesLoadPromise;
  if (typeof db === 'undefined' || !db) {
    _rolesPlansCache = [];
    _rolesLoadPromise = Promise.resolve([]);
    return _rolesLoadPromise;
  }
  _rolesLoadPromise = db.collection('plans').get()
    .then((snap) => {
      const list = [];
      snap.forEach((doc) => list.push(Object.assign({ id: doc.id }, doc.data())));
      list.sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0));
      _rolesPlansCache = list;
      return list;
    })
    .catch((err) => {
      console.error('Stryker: failed to load plans for role access', err);
      _rolesPlansCache = [];
      return [];
    });
  return _rolesLoadPromise;
}

// Look up a plan by id OR by name (students store their plan as a name
// string; content items store minRole as a plan id) — accepts either.
function findPlan(idOrName){
  if (!idOrName || !_rolesPlansCache) return null;
  return _rolesPlansCache.find((p) => p.id === idOrName) ||
         _rolesPlansCache.find((p) => (p.name || '').toLowerCase() === String(idOrName).toLowerCase()) ||
         null;
}

function rankOf(idOrName){
  const plan = findPlan(idOrName);
  return plan ? (plan.rank ?? 0) : 0;
}

function colorOf(idOrName){
  const plan = findPlan(idOrName);
  return plan && plan.color ? plan.color : '#8b93a0';
}

function labelOf(idOrName){
  const plan = findPlan(idOrName);
  return plan ? plan.name : String(idOrName || '');
}

// studentPlanNameOrId: what the student currently has (their `plan` field,
// a name string — or null/undefined if they have none).
// requiredIdOrName: the minRole on the content item / page (a plan id) —
// null/undefined means "no restriction, anyone signed in can access."
function hasRoleAccess(studentPlanNameOrId, requiredIdOrName){
  if (!requiredIdOrName) return true; // unrestricted item
  if (!studentPlanNameOrId) return false; // restricted item, no plan at all
  return rankOf(studentPlanNameOrId) >= rankOf(requiredIdOrName);
}

// Small colored pill, e.g. "PRO" — shown to the right of a user's name.
// Returns '' if the role can't be resolved (e.g. legacy content with no
// stored role), so callers can safely always append the result.
function roleTagHtml(planNameOrId, opts){
  if (!planNameOrId) return '';
  const plan = findPlan(planNameOrId);
  if (!plan) return '';
  const color = plan.color || '#8b93a0';
  const size = (opts && opts.size) || 'normal';
  const fontSize = size === 'small' ? '9.5px' : '10.5px';
  const pad = size === 'small' ? '1px 6px' : '2px 8px';
  return (
    '<span class="role-tag" style="display:inline-block; margin-left:7px; padding:' + pad + '; ' +
    'border-radius:999px; font-family:var(--font-mono); font-size:' + fontSize + '; font-weight:700; ' +
    'letter-spacing:0.04em; text-transform:uppercase; color:' + color + '; ' +
    'background:' + color + '1a; border:1px solid ' + color + '55; vertical-align:middle;">' +
    escapeRoleTagText(plan.name) + '</span>'
  );
}

function escapeRoleTagText(s){
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Fetch a single page-access requirement (a plan id, or null if that page
// isn't restricted) from settings/pageAccess. Cached per page load.
let _pageAccessCache = null;
function loadPageAccess(){
  if (_pageAccessCache) return Promise.resolve(_pageAccessCache);
  if (typeof db === 'undefined' || !db) return Promise.resolve({});
  return db.collection('settings').doc('pageAccess').get()
    .then((doc) => {
      _pageAccessCache = doc.exists ? (doc.data() || {}) : {};
      return _pageAccessCache;
    })
    .catch((err) => {
      console.error('Stryker: failed to load page access settings', err);
      _pageAccessCache = {};
      return _pageAccessCache;
    });
}

// The canonical list of gate-able pages, shown in the Roles & Access admin.
const GATEABLE_PAGES = [
  { key: 'curriculum', label: 'Curriculum (chapters list)' },
  { key: 'models', label: 'Trading models' },
  { key: 'trading-floor', label: 'Trading floor (community)' },
  { key: 'trade-journal', label: 'Trade journal' },
  { key: 'live-sessions', label: 'Live sessions' },
  { key: 'market-news', label: 'Market news' },
  { key: 'achievements', label: 'Achievements' }
];
