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
const getMark = () => { try { const m = JSON.parse(localStorage.getItem(MARK) || 'null'); return m && Date.now() - m.t < MAX_AGE_MS ? m : null; } catch (e) { return null; } };
const setMark = () => { try { localStorage.setItem(MARK, JSON.stringify({ t: Date.now() })); } catch (e) {} };
const clearMark = () => { try { localStorage.removeItem(MARK); } catch (e) {} };

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
  S.active = !!getMark();
  window.addEventListener('pagehide', () => { if (!S.active) clearMark(); });
  // Every load on a phone arms the mark; started() clears it after the chart has been stable for 20 s.
  setMark();

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
