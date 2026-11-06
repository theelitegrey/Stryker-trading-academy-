// TradeZoro — Zscript "My scripts" store (ES module). Same pattern as assets/chart-pine-scripts.js (Pine).
// Depends on: firebase compat SDKs + assets/auth.js when present; otherwise localStorage only.
//
// Signed-in members: Firestore students/{uid}/zscripts/{id} = { name 1-60, source 1-65536, createdAt, updatedAt }.
// Rules: functions-src/firestore.rules, "zscripts" block (owner only, fields + sizes validated). 50-script cap is here.
// Signed out, or a Firestore call that fails: localStorage stryker_zscripts_<uid|guest>.

const NAME_MAX = 60, SOURCE_MAX = 65536, MAX_COUNT = 50;
// shortcut: cloud saving stays OFF until the zscripts rules block is published to the live project (Owner/CoS step);
// until then scripts save in this browser. Flip to true in the same deploy that publishes the rules.
const CLOUD = false;

const fb = () => (typeof firebase !== 'undefined' && firebase.apps && firebase.apps.length ? firebase : null);
const ready = new Promise((resolve) => {
  let tries = 0;
  (function poll(){
    const f = fb();
    if (f && f.auth) {
      let done = false;
      const off = f.auth().onAuthStateChanged(() => { if (!done) { done = true; try { off(); } catch (e) {} resolve(); } });
      setTimeout(() => { if (!done) { done = true; resolve(); } }, 6000);
      return;
    }
    if (++tries > 40) { resolve(); return; }
    setTimeout(poll, 150);
  })();
});
const user = () => { try { const f = fb(); return f && f.auth().currentUser; } catch (e) { return null; } };
export const signedIn = () => !!user();
const useCloud = () => CLOUD && signedIn();
const col = () => fb().firestore().collection('students').doc(user().uid).collection('zscripts');
const err = (m) => { const e = new Error(m); e.userMessage = m; return e; };

function cleanName(n){ n = String(n || '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX); if (!n) throw err('Give the script a name.'); return n; }
function cleanSource(s){
  s = String(s || '');
  if (!s.trim()) throw err('The script is empty.');
  if (s.length > SOURCE_MAX) throw err('This script is too long to save (' + Math.round(s.length / 1024) + ' KB, limit 64 KB).');
  return s;
}
const lsKey = () => 'stryker_zscripts_' + (user() ? user().uid : 'guest');
const lsAll = () => { try { const a = JSON.parse(localStorage.getItem(lsKey()) || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; } };
const lsPut = (a) => { try { localStorage.setItem(lsKey(), JSON.stringify(a)); } catch (e) { throw err('Your browser storage is full, so the script was not saved.'); } };
const isLocal = (id) => lsAll().some((t) => t.id === id);
const sorted = (a) => a.sort((x, y) => (y.updatedAt || 0) - (x.updatedAt || 0));
const ms = (v) => (v && v.toMillis ? v.toMillis() : typeof v === 'number' ? v : 0);

export async function list(){
  await ready;
  if (!useCloud()) return { items: sorted(lsAll()), where: 'local' };
  try {
    const snap = await col().get();
    const items = [];
    snap.forEach((d) => { const x = d.data() || {}; items.push({ id: d.id, name: x.name || 'Untitled', source: x.source || '', createdAt: ms(x.createdAt), updatedAt: ms(x.updatedAt) }); });
    return { items: sorted(items.concat(lsAll())), where: 'cloud' };
  } catch (e) {
    console.warn('TradeZoro: Zscript list failed, using this browser', e);
    return { items: sorted(lsAll()), where: 'local', note: "Couldn't reach your account; showing scripts saved in this browser." };
  }
}

// id given = overwrite that script; no id = new script. Returns the id.
export async function save(name, source, id){
  await ready;
  name = cleanName(name); source = cleanSource(source);
  if (id && !isLocal(id) && useCloud()) {
    await col().doc(id).update({ name, source, updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
    return id;
  }
  if (id && isLocal(id)) {
    const a = lsAll(); a.forEach((t) => { if (t.id === id) { t.name = name; t.source = source; t.updatedAt = Date.now(); } }); lsPut(a);
    return id;
  }
  if (useCloud()) {
    const r = await list();
    if (r.where === 'cloud') {
      if (r.items.length >= MAX_COUNT) throw err('You have ' + MAX_COUNT + ' scripts. Delete one to save another.');
      const ts = firebase.firestore.FieldValue.serverTimestamp();
      try { return (await col().add({ name, source, createdAt: ts, updatedAt: ts })).id; }
      catch (e) { console.warn('TradeZoro: Zscript cloud save failed, saving in this browser', e); }
    }
  }
  const a = lsAll();
  if (a.length >= MAX_COUNT) throw err('You have ' + MAX_COUNT + ' scripts. Delete one to save another.');
  const nid = 'l' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), now = Date.now();
  a.push({ id: nid, name, source, createdAt: now, updatedAt: now });
  lsPut(a);
  return nid;
}

export async function rename(id, name){
  await ready;
  name = cleanName(name);
  if (useCloud() && !isLocal(id)) { await col().doc(id).update({ name, updatedAt: firebase.firestore.FieldValue.serverTimestamp() }); return; }
  const a = lsAll(); a.forEach((t) => { if (t.id === id) { t.name = name; t.updatedAt = Date.now(); } }); lsPut(a);
}

export async function remove(id){
  await ready;
  if (useCloud() && !isLocal(id)) await col().doc(id).delete();
  else lsPut(lsAll().filter((t) => t.id !== id));
}

export const LIMITS = { NAME_MAX, SOURCE_MAX, MAX_COUNT };
