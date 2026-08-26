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

// The plan every new account starts on: the lowest-ranked one that exists,
// resolved from the plans collection rather than hardcoded, so renaming
// "Starter" in Plans admin doesn't quietly strand new signups on a plan name
// that no longer matches anything.
//
// Students store their plan as a NAME string (see findPlan), so that's what
// this returns. Falls back to 'Starter' only if the collection can't be read
// at all — better to guess the conventional name than leave the field null,
// which is what triggered an upgrade modal on signup.
function defaultPlanName(){
  const plans = getCachedPlansForRoles();
  if (plans && plans.length) {
    // loadPlansForRoles already sorted ascending by rank.
    const lowest = plans[0];
    if (lowest && lowest.name) return lowest.name;
  }
  return 'Starter';
}

function resolveDefaultPlanName(){
  if (typeof loadPlansForRoles !== 'function') return Promise.resolve('Starter');
  return loadPlansForRoles().then(() => defaultPlanName()).catch(() => 'Starter');
}

// Public accessor for the already-loaded plans list, for pages that need
// to build their own UI from it (e.g. a plan-picker dropdown) without
// reaching into the internal cache variable directly.
function getCachedPlansForRoles(){
  return _rolesPlansCache || [];
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

// Parses a plan's `chapterAccess` field into a numeric ceiling.
// Accepts: "all" / "" / unset -> Infinity (unlimited).
//          a plain number like "5" or "7" -> that number (chapters 1..N).
//          a range like "1-7" -> the upper bound, 7 (lower bound is ignored
//          since access always starts from chapter 1 in this curriculum).
//          anything unparseable -> Infinity, so a typo never accidentally
//          locks students out — it just fails open.
function chapterLimitOf(planNameOrId){
  const plan = findPlan(planNameOrId);
  const raw = plan ? plan.chapterAccess : null;
  if (!raw || typeof raw !== 'string') return Infinity;
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed || trimmed === 'all') return Infinity;
  const rangeMatch = trimmed.match(/^(\d+)\s*-\s*(\d+)$/);
  if (rangeMatch) return parseInt(rangeMatch[2], 10);
  const singleMatch = trimmed.match(/^(\d+)$/);
  if (singleMatch) return parseInt(singleMatch[1], 10);
  return Infinity; // fail open on anything unexpected
}

// studentPlanNameOrId: the student's current plan (name string), or null.
// chapterNum: the chapter's `num` field — a zero-padded string like "05" in
// this curriculum, so it's parsed as an integer before comparing.
function hasChapterNumberAccess(studentPlanNameOrId, chapterNum){
  const n = parseInt(chapterNum, 10);
  if (isNaN(n)) return true; // can't parse the chapter number, fail open

  // A missing plan used to block every chapter, on the reasoning that no plan
  // meant nothing purchased. That stopped being true when accounts started
  // defaulting to the entry plan: a blank `plan` now means the student doc
  // hasn't been healed yet, not that someone is reading for free. Blocking
  // them locked legitimate students — including paying ones whose plan simply
  // hadn't loaded — out of chapter 1 with an upgrade prompt.
  //
  // Fall back to the entry tier's own limit instead. Someone genuinely
  // planless gets exactly what a new signup gets, and nobody is shut out by a
  // field that has not caught up.
  if (!studentPlanNameOrId) {
    const entry = (typeof defaultPlanName === 'function') ? defaultPlanName() : null;
    if (!entry) return true;                       // plans unreadable — fail open
    return n <= chapterLimitOf(entry);
  }

  // An unrecognised plan name is a data problem, not a permission one — a
  // renamed plan, or a cache that failed to load. chapterLimitOf would return
  // Infinity anyway; being explicit stops a future edit turning a lookup miss
  // into a lockout.
  if (!findPlan(studentPlanNameOrId)) {
    console.warn('Stryker: plan "' + studentPlanNameOrId + '" not found in the plans collection — allowing access');
    return true;
  }

  return n <= chapterLimitOf(studentPlanNameOrId);
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

// A page's settings/pageAccess[key] value used to always be a plain plan-id
// string (or null). View-only access adds a second, lower threshold, so the
// value is now normally an object — this reads either shape so nothing
// already saved before this feature existed breaks.
function normalizePageAccessConfig(raw){
  if (raw && typeof raw === 'object') {
    return { minRole: raw.minRole || null, viewOnlyRole: raw.viewOnlyRole || null };
  }
  return { minRole: raw || null, viewOnlyRole: null };
}

// Three possible outcomes for a student visiting a gated page:
//   'blocked' — can't see the page at all (below the lowest configured bar)
//   'view'    — can see the page's content, but shouldn't get interactive
//               access (at or above viewOnlyRole, but below minRole)
//   'full'    — full access (at or above minRole)
// A page with neither threshold set is unrestricted ('full' for anyone).
function getPageAccessLevel(studentPlanNameOrId, rawConfig){
  const config = normalizePageAccessConfig(rawConfig);
  if (!config.minRole && !config.viewOnlyRole) return 'full';
  if (hasRoleAccess(studentPlanNameOrId, config.minRole)) return 'full';
  if (config.viewOnlyRole && hasRoleAccess(studentPlanNameOrId, config.viewOnlyRole)) return 'view';
  return 'blocked';
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
  { key: 'indicators', label: 'Trading indicators' },
  { key: 'trading-floor', label: 'Trading floor (community)' },
  { key: 'trade-journal', label: 'Trade journal' },
  { key: 'live-sessions', label: 'Live sessions' },
  { key: 'global-monitor', label: 'Global Monitor (war & geopolitics terminal)' },
  { key: 'achievements', label: 'Achievements' },
  { key: 'referrals', label: 'Invite & Earn (referrals)' }
];
