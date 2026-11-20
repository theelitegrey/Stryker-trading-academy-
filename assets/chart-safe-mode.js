// CRASH-LOOP GUARD (phone memory, 09 Nov; a safety net that should almost never show).
// Member report: on an iPhone a heavy layout ran the tab out of memory again and again ("A problem repeatedly
// occurred"), so the Charts page could not be used at all.
// Phones only (narrow screen, coarse pointer or <= 4 GB device memory); desktop behaviour is unchanged.
//  - Before the chart restores a layout, a "chart loading" mark goes into localStorage. It is cleared once the chart
//    has been stable for 20 s, and on a normal page exit (pagehide, which a killed tab never fires).
//  - If the page starts and finds the mark, the last load never finished: the layout opens in SAFE MODE. The chart
//    and symbol open, indicators are listed in a banner but not run, and each one (or all) can be turned back on.
//  - The saved layout is never written over in safe mode: the workspace's local save is paused (window.__stkSafe
//    is checked by chart-layouts.js for the account save too) until every indicator is back on.
const MARK = 'stryker_chart_loading';
const STABLE_MS = 20000;
const MAX_AGE_MS = 864e5;   // a mark older than a day is not a crash loop

const phone = () => {
  try { return window.innerWidth <= 700 || matchMedia('(pointer: coarse)').matches || (navigator.deviceMemory && navigator.deviceMemory <= 4); } catch (e) { return false; }
};
// Two tabs / app windows share localStorage. Before, one shared mark meant a second window opened while the first was
// still loading (its mark set, not yet stable) started in SAFE MODE and saved nothing (20 Nov: two workspaces at once).
// Now each tab keeps its own entry, keyed by a per-tab id (sessionStorage), and a new tab that finds another tab's
// entry asks on a BroadcastChannel whether that tab is alive: a crashed tab cannot answer, a living one does.
const PING_MS = 250;
const TAB = (() => { try { let id = sessionStorage.getItem('stryker_tab_id'); if (!id) { id = Math.random().toString(36).slice(2, 10); sessionStorage.setItem('stryker_tab_id', id); } return id; } catch (e) { return Math.random().toString(36).slice(2, 10); } })();
const readMarks = () => {
  try {
    const m = JSON.parse(localStorage.getItem(MARK) || 'null');
    if (!m || typeof m !== 'object') return {};
    if (typeof m.t === 'number') return { _old: { t: m.t } };   // the older single mark
    return m;
  } catch (e) { return {}; }
};
const writeMarks = (m) => { try { if (Object.keys(m).length) localStorage.setItem(MARK, JSON.stringify(m)); else localStorage.removeItem(MARK); } catch (e) {} };
const liveMarks = () => { const now = Date.now(), m = readMarks(); for (const id of Object.keys(m)) if (!m[id] || typeof m[id].t !== 'number' || now - m[id].t >= MAX_AGE_MS) delete m[id]; return m; };
const setMark = (alive) => { const m = liveMarks(); for (const id of Object.keys(m)) if (id !== TAB && !(alive && alive.has(id))) delete m[id]; m[TAB] = { t: Date.now() }; writeMarks(m); };
const clearMark = () => { const m = readMarks(); delete m[TAB]; writeMarks(m); };
let chan = null;
try { chan = new BroadcastChannel('stryker_chart_alive'); chan.onmessage = (e) => { if (e.data && e.data.q && e.data.from !== TAB) chan.postMessage({ a: TAB }); }; } catch (e) { chan = null; }
// the other tabs that answer within PING_MS (no channel: none can be asked, so every other entry counts as alive)
const askAlive = (ids) => new Promise((res) => {
  if (!ids.length) return res(new Set());
  if (!chan) return res(new Set(ids));
  const got = new Set();
  const on = (e) => { if (e.data && e.data.a) got.add(e.data.a); };
  chan.addEventListener('message', on);
  chan.postMessage({ q: 1, from: TAB });
  setTimeout(() => { chan.removeEventListener('message', on); res(got); }, PING_MS);
});

// what safe mode pauses, per chart: Pine scripts (ext 'stryker.pine') and native indicators (indicators.natives)
function pausedOf(doc){
  const out = [];
  for (const c of (doc && doc.charts) || []) {
    const pine = (c.ext && Array.isArray(c.ext['stryker.pine'])) ? c.ext['stryker.pine'] : [];
    pine.forEach((p, i) => out.push({ cell: c.id, kind: 'pine', i, name: String(p.name || 'Pine script') }));
    const nat = (c.indicators && Array.isArray(c.indicators.natives)) ? c.indicators.natives : [];
    nat.forEach((n) => { const type = typeof n === 'string' ? n : (n && n.type); if (type && type !== 'volume') out.push({ cell: c.id, kind: 'native', type, raw: n }); });
  }
  return out;
}
function stripped(doc){
  const d = JSON.parse(JSON.stringify(doc));
  for (const c of d.charts || []) {
    if (c.ext) delete c.ext['stryker.pine'];
    if (c.indicators && Array.isArray(c.indicators.natives)) c.indicators.natives = c.indicators.natives.filter((n) => (typeof n === 'string' ? n : n && n.type) === 'volume');
  }
  return d;
}

export function createSafeMode(persistKey){
  const S = window.__stkSafe = { active: false, paused: [], phone: phone() };
  if (!S.phone) return Object.assign(S, { storage: undefined, strip: (d) => d, started(){}, mount(){} });
  // A load whose own entry (same tab, reloaded) or a dead tab's entry is still set never finished: safe mode.
  const marks = liveMarks(), others = Object.keys(marks).filter((id) => id !== TAB);
  S.ready = (marks[TAB] ? Promise.resolve(new Set(others)) : askAlive(others)).then((alive) => {
    S.active = !!marks[TAB] || others.some((id) => !alive.has(id));
    // Every load on a phone arms its mark; started() clears it after the chart has been stable for 20 s.
    setMark(alive);
  });
  window.addEventListener('pagehide', () => { if (!S.active) clearMark(); });

  S.strip = (doc) => {
    if (!S.active || !doc || !Array.isArray(doc.charts)) return doc;
    S.orig = doc;
    S.paused = pausedOf(doc);
    if (S.onChange) S.onChange();
    return stripped(doc);
  };
  // workspace storage: reads the saved layout through strip(); writes nothing while safe mode is on
  S.storage = {
    get(k){ let raw = null; try { raw = localStorage.getItem(k); } catch (e) {} if (!S.active || !raw) return raw; try { return JSON.stringify(S.strip(JSON.parse(raw))); } catch (e) { return raw; } },
    set(k, v){ if (S.active) return; try { localStorage.setItem(k, v); } catch (e) {} },
    remove(k){ if (S.active) return; try { localStorage.removeItem(k); } catch (e) {} }
  };
  let stableTimer = null;
  S.started = () => { clearTimeout(stableTimer); if (!S.active) stableTimer = setTimeout(clearMark, STABLE_MS); };
  S.persistKey = persistKey;
  return S;
}

// The banner + "Turn them back on". ws = the workspace, applySaved = STRYKER_CHART_UI.applySaved.
export function mountSafeBanner(S, ws, applySaved){
  if (!S.phone) return;
  let el = null;
  const restore = (pick) => {
    const cur = ws.getState(), orig = S.orig;
    if (!orig) return;
    const back = S.paused.filter(pick);
    for (const c of cur.charts || []) {
      const o = (orig.charts || []).find((x) => x.id === c.id);
      if (!o) continue;
      const mine = back.filter((p) => p.cell === c.id);
      const pine = mine.filter((p) => p.kind === 'pine').map((p) => o.ext['stryker.pine'][p.i]);
      if (pine.length) { c.ext = c.ext || {}; c.ext['stryker.pine'] = (c.ext['stryker.pine'] || []).concat(pine); }
      const nat = mine.filter((p) => p.kind === 'native').map((p) => p.raw);
      if (nat.length) { c.indicators = c.indicators || { manifest: [], natives: [] }; c.indicators.natives = (c.indicators.natives || []).concat(nat); }
    }
    S.paused = S.paused.filter((p) => !back.includes(p));
    if (!S.paused.length) S.active = false;     // everything is back: saving resumes, and the next state change saves
    setMark();                                  // the indicators load again: guard this load too
    applySaved({ state: cur });
    S.started();
    paint();
  };
  const paint = () => {
    if (!S.active || !S.paused.length) { if (el) el.remove(); el = null; return; }
    const list = document.createElement('div');
    list.className = 'stks-list';
    for (const p of S.paused) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'stks-chip';
      b.textContent = p.kind === 'pine' ? p.name : nativeTitle(ws, p.type);
      b.setAttribute('aria-label', 'Turn ' + b.textContent + ' back on');
      b.addEventListener('click', () => restore((x) => x === p));
      list.appendChild(b);
    }
    const msg = document.createElement('p');
    msg.className = 'stks-msg';
    msg.textContent = 'Your chart closed unexpectedly on this phone. Indicators are paused.';
    const all = document.createElement('button');
    all.type = 'button'; all.className = 'stks-on'; all.textContent = 'Turn them back on';
    all.addEventListener('click', () => restore(() => true));
    const next = document.createElement('div');
    next.className = 'stks-banner'; next.id = 'stks-banner'; next.setAttribute('role', 'status');
    next.append(msg, all, list);
    if (el) el.replaceWith(next); else { const bar = document.getElementById('stkc-bar'); if (bar && bar.parentNode) bar.parentNode.insertBefore(next, bar.nextSibling); else document.body.prepend(next); }
    el = next;
    try { window.dispatchEvent(new Event('resize')); } catch (e) {}
  };
  S.onChange = paint;
  paint();
}

function nativeTitle(ws, type){
  try { const n = (ws.active.nativeCatalog || []).find((x) => x.type === type); if (n && n.title) return n.title; } catch (e) {}
  return ({ stk_of_abs: 'Absorption', stk_l2f_big: 'Big trades', stk_gex: 'GEX levels' })[type] || type;
}
