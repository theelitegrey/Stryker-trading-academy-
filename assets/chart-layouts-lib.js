// ZoroCharts LAYOUTS LIBRARY (Owner order 2026-11-01. Roadmap: Save and share chart layouts) — ES module,
// loaded on first use by assets/chart-layouts.js, which hands in `host` (its own helpers).
//
// A bottom sheet on phones, a dialog on desktop, three tabs: Browse · My Layouts · Favorites.
// Data (rules: functions-src/firestore.rules, "LAYOUTS LIBRARY"):
//   students/{uid}/chartLayouts/{id}        my layout (+ thumb, panes, indicators, vis, desc, tags, cid)
//   chartShared/{id}                        "Link only" (anyone signed in with the link, read-only)
//   publicLayouts/{id}                      card + counters for Public and Community layouts
//   publicLayouts/{id}/data/s               the chart state; Community state is readable by active members only
//   publicLayouts/{id}/likes|uses|reports/{uid}   one marker per member; the counter moves with the marker
//   students/{uid}/layoutFavs/{id}          my stars
// Every layout from another member goes through host.applyForeign (StrykerPineGuard) before it loads.

const WEEK = 7 * 864e5;
const TAGS = ['day trading', 'scalping', 'swing', 'order flow', 'smart money', 'gex', 'volume', 'trend', 'ict', 'futures', 'crypto', 'forex'];
// Small block list (publish-time filter, not moderation of meaning). Whole words, lowercase.
const BLOCK = ['fuck', 'fucking', 'shit', 'bitch', 'cunt', 'nigger', 'nigga', 'faggot', 'retard', 'whore', 'slut', 'porn', 'porno', 'sex', 'nude', 'nudes', 'dick', 'cock', 'pussy', 'blowjob', 'xxx'];
export function blocked(text){
  const w = String(text || '').toLowerCase().split(/[^a-z0-9]+/);
  return w.some((x) => BLOCK.includes(x));
}
export function cleanTag(t){ return String(t || '').toLowerCase().replace(/[^a-z0-9 _-]+/g, '').replace(/\s+/g, ' ').replace(/^[ _-]+/, '').trim().slice(0, 20); }

const ICON = {
  heart: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" aria-hidden="true"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.600-7 10-7 10z"/></svg>',
  users: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" aria-hidden="true"><circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.300 2.700-5.500 6-5.500s6 2.200 6 5.500M16 5a3 3 0 0 1 0 6M18 14.800c1.700.8 3 2.600 3 5.200"/></svg>',
  star: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M12 3.500l2.700 5.500 6 .9-4.400 4.200 1 6-5.300-2.800L6.700 20l1-6L3.300 9.900l6-.9z"/></svg>',
  dots: '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.800"/><circle cx="12" cy="12" r="1.800"/><circle cx="19" cy="12" r="1.800"/></svg>',
  plus: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  x: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  up: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" aria-hidden="true"><path d="M12 16V4M7 9l5-5 5 5M5 20h14"/></svg>',
  lock: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>',
  search: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" aria-hidden="true"><circle cx="11" cy="11" r="6.500"/><path d="M16 16l4.500 4.500"/></svg>'
};

export function mountLib(host){
  const { el, toast, db } = host;
  const pub = () => db().collection('publicLayouts');
  const me = () => host.user();
  const favCol = () => db().collection('students').doc(me().uid).collection('layoutFavs');

  const S = { tab: 'browse', sort: 'trending', filter: 'all', mySort: 'recent', q: '', items: [], mine: [], favs: new Set(), liked: new Set(), favItems: [], hiddenView: false, admin: false, busy: false, err: '' };
  let root = null, bodyEl = null, searchEl = null, tabBtns = {}, hdrAct = null, closeSheet = null;

  const isNew = (x) => x.createdAt && Date.now() - x.createdAt < WEEK;
  const pubOf = (d) => { const x = d.data() || {}; return Object.assign({}, x, { id: d.id, createdAt: host.tsMs(x.createdAt), updatedAt: host.tsMs(x.updatedAt) }); };

  // ---------------------------------------------------------------- data
  async function loadBrowse(){
    S.err = '';
    try {
      let docs = [];
      if (S.hiddenView) {
        docs = (await pub().where('hidden', '==', true).limit(60).get()).docs;
      } else {
        const base = () => pub().where('visibility', '==', 'public').where('hidden', '==', false);
        const [a, b] = await Promise.all([base().orderBy('useCount', 'desc').limit(60).get(), base().orderBy('createdAt', 'desc').limit(60).get()]);
        const seen = new Set();
        a.docs.concat(b.docs).forEach((d) => { if (!seen.has(d.id)) { seen.add(d.id); docs.push(d); } });
      }
      S.items = docs.map(pubOf);
      const shown = S.items.slice(0, 80);
      const likes = await Promise.all(shown.map((x) => pub().doc(x.id).collection('likes').doc(me().uid).get().then((d) => d.exists).catch(() => false)));
      shown.forEach((x, i) => { if (likes[i]) S.liked.add(x.id); });
    } catch (e) { console.warn('TradeZoro: layouts browse', e); S.items = []; S.err = 'Could not load the library. Check your connection.'; }
  }
  async function loadFavIds(){
    try { const s = await favCol().get(); S.favs = new Set(s.docs.map((d) => d.id)); } catch (e) { S.favs = new Set(); }
  }
  async function loadFavItems(){
    await loadFavIds();
    const ids = [...S.favs].slice(0, 50);
    const got = await Promise.all(ids.map((id) => pub().doc(id).get().then((d) => (d.exists ? pubOf(d) : null)).catch(() => null)));
    S.favItems = got.filter((x) => x && !x.hidden);
    const likes = await Promise.all(S.favItems.map((x) => pub().doc(x.id).collection('likes').doc(me().uid).get().then((d) => d.exists).catch(() => false)));
    S.favItems.forEach((x, i) => { if (likes[i]) S.liked.add(x.id); });
  }
  async function loadMine(){ try { S.mine = await host.list(); } catch (e) { S.mine = []; S.err = 'Could not load your layouts.'; } }

  async function toggleFav(x){
    const ref = favCol().doc(x.id);
    try {
      if (S.favs.has(x.id)) { await ref.delete(); S.favs.delete(x.id); S.favItems = S.favItems.filter((y) => y.id !== x.id); }
      else { await ref.set({ at: host.ts() }); S.favs.add(x.id); }
      render();
    } catch (e) { toast('Could not update favorites.', 'error'); }
  }
  async function toggleLike(x){
    const ref = pub().doc(x.id), lk = ref.collection('likes').doc(me().uid);
    const on = S.liked.has(x.id);
    try {
      const b = db().batch();
      if (on) { b.delete(lk); b.update(ref, { likeCount: firebase.firestore.FieldValue.increment(-1) }); }
      else { b.set(lk, { at: host.ts() }); b.update(ref, { likeCount: firebase.firestore.FieldValue.increment(1) }); }
      await b.commit();
      if (on) { S.liked.delete(x.id); x.likeCount = Math.max(0, (x.likeCount || 0) - 1); } else { S.liked.add(x.id); x.likeCount = (x.likeCount || 0) + 1; }
      render();
    } catch (e) { console.warn('TradeZoro: like', e); toast('Could not update the like.', 'error'); }
  }

  // Apply = read the state (rules gate it), Pine guard, load, then count one use per member.
  async function applyItem(x){
    if (x.locked) return;
    try {
      const d = await pub().doc(x.id).collection('data').doc('s').get();
      if (!d.exists) { toast('This layout is no longer available.', 'error'); return; }
      let doc; try { doc = JSON.parse(d.data().state); } catch (e) { doc = null; }
      if (!doc) { toast('This layout could not be read.', 'error'); return; }
      const ok = await host.applyForeign(doc, x.name);
      if (!ok) return;
      closeSheet();
      if (x.ownerUid !== me().uid) {
        const ref = pub().doc(x.id), u = ref.collection('uses').doc(me().uid);
        const seen = await u.get();
        if (!seen.exists) {
          const b = db().batch();
          b.set(u, { at: host.ts() });
          b.update(ref, { useCount: firebase.firestore.FieldValue.increment(1) });
          await b.commit().catch((e) => console.warn('TradeZoro: use count', e));
        }
      }
    } catch (e) {
      console.warn('TradeZoro: apply layout', e);
      toast(x.visibility === 'community' ? 'Join the community to use this layout.' : 'Could not apply this layout.', 'error');
    }
  }

  async function report(x){
    const reason = await pick('Report this layout', [['spam', 'Spam'], ['abuse', 'Abusive or offensive'], ['copied', 'Copied from someone else'], ['results', 'Claims trading results'], ['other', 'Something else']]);
    if (!reason) return;
    try {
      const ref = pub().doc(x.id), r = ref.collection('reports').doc(me().uid);
      if ((await r.get().catch(() => ({ exists: false }))).exists) { toast('You already reported this layout.'); return; }
      const b = db().batch();
      b.set(r, { reason, at: host.ts() });
      b.update(ref, { reportCount: firebase.firestore.FieldValue.increment(1) });
      await b.commit();
      toast('Report sent. Thank you.');
    } catch (e) { toast('Could not send the report.', 'error'); }
  }
  async function adminHide(x, hide){
    try { await pub().doc(x.id).update({ hidden: hide }); toast(hide ? 'Hidden from Browse' : 'Restored'); S.items = S.items.filter((y) => y.id !== x.id); render(); }
    catch (e) { toast('Could not change that.', 'error'); }
  }

  // ---------------------------------------------------------------- small dialogs
  function pick(title, opts){
    return new Promise((res) => {
      const list = el('div', { class: 'lyl-pick' }, opts.map(([v, t]) => { const b = el('button', { type: 'button', class: 'lyl-row', text: t }); b.addEventListener('click', () => { m.done(); res(v); }); return b; }));
      const m = host.modal(title, el('div', { class: 'stkl-body' }, [list]));
      m.box.classList.add('lyl-dlg');
      m.box.parentNode.addEventListener('mousedown', (e) => { if (e.target === m.box.parentNode) res(null); });
    });
  }

  async function myCommunities(){
    try {
      const s = await db().collection('communities').where('ownerUid', '==', me().uid).get();
      return s.docs.map((d) => ({ id: d.id, name: (d.data() || {}).name || d.id })).slice(0, 3);
    } catch (e) { return []; }
  }

  // ---------------------------------------------------------------- publish dialog
  async function publishDialog(id){
    if (!me()) { toast('Sign in to publish layouts.', 'error'); return; }
    if (!id) { // no layout yet: save the open chart first
      if (!host.cur) { host.askName('Save layout', 'My layout', async (n) => { await host.saveAsNew(n); if (host.cur) publishDialog(host.cur.id); }); return; }
      id = host.cur.id;
    }
    if (host.cur && host.cur.id === id && host.dirty) await host.saveNow(false);
    const snap = await host.col().doc(id).get();
    if (!snap.exists) { toast('That layout no longer exists.', 'error'); return; }
    const x = snap.data();
    const comms = await myCommunities();
    const f = { vis: x.vis || (x.shared ? 'link' : 'private'), tags: (x.tags || []).slice(0, 5), cid: x.cid || (comms[0] && comms[0].id) || '' };

    const name = el('input', { type: 'text', class: 'stkc-in', maxlength: '60', 'aria-label': 'Name' }); name.value = x.name || '';
    const desc = el('textarea', { class: 'lyl-ta', maxlength: '140', rows: '2', 'aria-label': 'Description', placeholder: 'What is this layout for? (optional)' }); desc.value = x.desc || '';
    const cnt = el('small', { class: 'lyl-cnt' });
    const upd = () => { cnt.textContent = desc.value.length + '/140'; }; desc.addEventListener('input', upd); upd();
    const chips = el('div', { class: 'lyl-chips' });
    const custom = el('input', { type: 'text', class: 'stkc-in', maxlength: '20', placeholder: 'Add a tag', 'aria-label': 'Custom tag' });
    const paintTags = () => {
      chips.innerHTML = '';
      TAGS.concat(f.tags.filter((t) => !TAGS.includes(t))).forEach((t) => {
        const on = f.tags.includes(t);
        const b = el('button', { type: 'button', class: 'lyl-chip' + (on ? ' on' : ''), text: '#' + t, 'aria-pressed': on ? 'true' : 'false' });
        b.addEventListener('click', () => { if (on) f.tags = f.tags.filter((y) => y !== t); else if (f.tags.length < 5) f.tags.push(t); else toast('Up to 5 tags.'); paintTags(); });
        chips.appendChild(b);
      });
    };
    custom.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); const t = cleanTag(custom.value); if (t && !f.tags.includes(t)) { if (f.tags.length >= 5) toast('Up to 5 tags.'); else f.tags.push(t); } custom.value = ''; paintTags(); } });
    paintTags();

    const visWrap = el('div', { class: 'lyl-vis', role: 'radiogroup', 'aria-label': 'Visibility' });
    const note = el('p', { class: 'stkc-note lyl-note' });
    const err = el('p', { class: 'stkc-err', hidden: '' });
    const OPTS = [['private', 'Private', 'Only me. The default.'], ['link', 'Link only', 'Anyone signed in with the link can view it.'], ['public', 'Public', 'Listed in the library for every member.'], ['community', 'Community', 'Only members of one of your communities can use it.']];
    const commSel = el('select', { class: 'stkc-in', 'aria-label': 'Community' }, comms.map((c) => el('option', { value: c.id, text: c.name })));
    commSel.value = f.cid; commSel.addEventListener('change', () => { f.cid = commSel.value; });
    const commBox = el('div', { class: 'lyl-comm' });
    const paintVis = () => {
      visWrap.innerHTML = '';
      OPTS.forEach(([v, t, s]) => {
        const b = el('button', { type: 'button', class: 'lyl-vopt' + (f.vis === v ? ' on' : ''), role: 'radio', 'aria-checked': f.vis === v ? 'true' : 'false' }, [el('b', { text: t }), el('small', { text: s })]);
        b.addEventListener('click', () => { f.vis = v; paintVis(); });
        visWrap.appendChild(b);
      });
      commBox.innerHTML = '';
      if (f.vis === 'community') {
        if (comms.length) { if (!f.cid) f.cid = comms[0].id; commSel.value = f.cid; commBox.appendChild(commSel); commBox.appendChild(el('p', { class: 'stkc-note', text: 'Selling = placing the layout behind this community\'s existing membership. Set plans and prices in Creator Hub.' })); }
        else commBox.appendChild(el('p', { class: 'stkc-note' }, [document.createTextNode('Create a community in Creator Hub to sell layouts. '), el('a', { href: 'creator-new', class: 'lyl-a', text: 'Open Creator Hub' })]));
      }
    };
    paintVis();
    const ok = el('button', { type: 'button', class: 'stkc-sbtn lyl-pri', text: 'Publish' });
    const body = el('div', { class: 'stkl-body lyl-form' }, [
      el('label', { class: 'lyl-lbl', text: 'Name' }), name,
      el('label', { class: 'lyl-lbl', text: 'Description' }), desc, cnt,
      el('label', { class: 'lyl-lbl', text: 'Tags (up to 5)' }), chips, custom,
      el('label', { class: 'lyl-lbl', text: 'Who can see it' }), visWrap, commBox, note, err,
      el('p', { class: 'stkc-note', text: 'Everything in the chart is included: indicators and their settings, panes and drawings. Education only. Not financial advice.' })]);
    const m = host.modal('Publish layout', body, el('div', { class: 'stkl-ft' }, [ok]));
    m.box.classList.add('lyl-dlg', 'lyl-pub');
    const bad = (t) => { err.hidden = false; err.textContent = t; ok.disabled = false; };

    ok.addEventListener('click', async () => {
      const nm = name.value.replace(/\s+/g, ' ').trim().slice(0, 60), ds = desc.value.replace(/\s+/g, ' ').trim().slice(0, 140);
      if (!nm) return bad('Give the layout a name.');
      if (f.vis !== 'private' && (blocked(nm) || blocked(ds) || f.tags.some(blocked))) return bad('Please remove offensive or adult words from the name, description or tags.');
      if (f.vis === 'community' && !f.cid) return bad('Create a community in Creator Hub first.');
      ok.disabled = true; err.hidden = true;
      try { await doPublish(id, x, { name: nm, desc: ds, tags: f.tags.slice(0, 5), vis: f.vis, cid: f.vis === 'community' ? f.cid : '' }); m.done(); }
      catch (e) { console.warn('TradeZoro: publish', e); bad(e.userMessage || 'Could not publish. Check your connection and try again.'); }
    });
  }

  async function authorName(){
    try {
      const d = await db().collection('profiles').doc(me().uid).get();
      const n = d.exists ? String((d.data() || {}).displayName || '') : '';
      return n && n.length <= 60 && !n.includes('@') ? n : 'Member';
    } catch (e) { return 'Member'; }
  }

  async function doPublish(id, x, o){
    const mine = host.col().doc(id);
    const cd = (await mine.get()).data();
    let state = cd.state, doc = null; try { doc = JSON.parse(state); } catch (e) {}
    const k = host.countOf(doc);
    const extra = { name: o.name, desc: o.desc, tags: o.tags, vis: o.vis, cid: o.cid, panes: k.panes, indicators: k.indicators };
    const wasShared = !!cd.shared;
    const ref = pub().doc(id);

    if (o.vis === 'public' || o.vis === 'community') {
      const author = await authorName();
      const card = { authorName: author, name: o.name, desc: o.desc, tags: o.tags, visibility: o.vis, communityId: o.cid, symbol: cd.symbol || '', interval: cd.interval || '', thumb: cd.thumb || '', panes: k.panes, indicators: k.indicators };
      const ex = await ref.get().catch(() => ({ exists: false }));
      // the layout doc first (rules need it to exist), then card + state in one batch
      await mine.set(Object.assign({ name: cd.name, state, symbol: cd.symbol || '', interval: cd.interval || '', shared: wasShared, updatedAt: host.ts(), thumb: cd.thumb || '' }, extra, { name: o.name }), { merge: true });
      const b = db().batch();
      if (ex.exists) b.update(ref, Object.assign({}, card, { updatedAt: host.ts() }));
      else b.set(ref, Object.assign({ ownerUid: me().uid }, card, { likeCount: 0, useCount: 0, reportCount: 0, hidden: false, createdAt: host.ts(), updatedAt: host.ts() }));
      b.set(ref.collection('data').doc('s'), { state, updatedAt: host.ts() });
      await b.commit();
      if (wasShared) { await host.sharedDoc(id).delete().catch(() => {}); await mine.update({ shared: false }); }
    } else {
      if (o.vis === 'link') await host.writeShared(id, o.name, state);
      else if (wasShared) await host.sharedDoc(id).delete().catch(() => {});
      const ex = await ref.get().catch(() => ({ exists: false }));
      if (ex.exists) { await ref.collection('data').doc('s').delete().catch(() => {}); await ref.delete(); }
      await mine.set({ name: o.name, state, symbol: cd.symbol || '', interval: cd.interval || '', shared: o.vis === 'link', updatedAt: host.ts(), thumb: cd.thumb || '', ...extra }, { merge: true });
    }
    host.refresh(id, { name: o.name, shared: o.vis === 'link' });
    await loadMine(); render();
    const msg = { private: 'Saved as private.', link: 'Link sharing on. Link copied.', public: 'Published to the library.', community: 'Published to your community.' }[o.vis];
    toast(msg);
    if (o.vis === 'link') host.copyLink(id);
  }
  async function unpublish(x){
    await doPublish(x.id, x, { name: x.name, desc: x.desc || '', tags: x.tags || [], vis: 'private', cid: '' }).catch(() => toast('Could not unpublish.', 'error'));
  }

  // ---------------------------------------------------------------- views
  const thumbEl = (x, cls) => {
    const d = el('div', { class: 'lyl-th ' + (cls || '') });
    if (x.thumb) { const i = el('img', { src: x.thumb, alt: '', loading: 'lazy', draggable: 'false' }); d.appendChild(i); }
    else d.appendChild(el('span', { text: host.symLabel(x.symbol) || 'Chart' }));
    return d;
  };
  const txt = (tag, cls, t) => el(tag, { class: cls, text: t });
  const sortItems = (a) => {
    const arr = a.slice();
    if (S.sort === 'new') arr.sort((p, q) => q.createdAt - p.createdAt);
    else if (S.sort === 'used') arr.sort((p, q) => (q.useCount || 0) - (p.useCount || 0) || q.createdAt - p.createdAt);
    else arr.sort((p, q) => ((q.useCount || 0) * 2 + (q.likeCount || 0)) - ((p.useCount || 0) * 2 + (p.likeCount || 0)) || q.createdAt - p.createdAt);
    return arr;
  };
  const matches = (x) => {
    const q = S.q.trim().toLowerCase().replace(/^#/, '');
    return !q || String(x.name).toLowerCase().includes(q) || String(x.authorName).toLowerCase().includes(q) || (x.tags || []).some((t) => t.includes(q));
  };

  function ownerHandle(x){ return x.ownerUid === me().uid ? 'You' : (x.authorName || 'Member'); }

  function menu(anchor, items){
    const old = document.querySelector('.lyl-menu'); if (old) old.remove();
    const m = el('div', { class: 'lyl-menu', role: 'menu' });
    items.forEach((it) => { if (!it) return; const b = el('button', { type: 'button', role: 'menuitem', class: it.danger ? 'danger' : '', text: it[0] || it.t }); b.addEventListener('click', () => { m.remove(); (it.run || it[1])(); }); m.appendChild(b); });
    root.querySelector('.lyl-panel').appendChild(m);
    const r = anchor.getBoundingClientRect(), p = root.querySelector('.lyl-panel').getBoundingClientRect();
    m.style.top = Math.min(r.bottom - p.top + 4, p.height - m.offsetHeight - 8) + 'px';
    m.style.left = Math.max(8, Math.min(r.right - p.left - 188, p.width - 196)) + 'px';
    const off = (e) => { if (!m.contains(e.target)) { m.remove(); document.removeEventListener('pointerdown', off, true); } };
    setTimeout(() => document.addEventListener('pointerdown', off, true), 0);
  }

  function actionBtn(x){
    if (x.locked) return null;
    const b = el('button', { type: 'button', class: 'lyl-apply', html: ICON.plus + '<span>Apply</span>', 'aria-label': 'Apply ' + x.name });
    b.addEventListener('click', (e) => { e.stopPropagation(); applyItem(x); });
    return b;
  }

  function lockFor(x){
    if (x.visibility !== 'community') return null;
    return el('a', { class: 'lyl-lock', href: 'c/' + encodeURIComponent(x.communityId), html: ICON.lock + '<span>Join the community to use</span>' });
  }

  function row(x){
    const fav = el('button', { type: 'button', class: 'lyl-ib lyl-fav' + (S.favs.has(x.id) ? ' on' : ''), html: ICON.star, 'aria-label': (S.favs.has(x.id) ? 'Remove from favorites: ' : 'Add to favorites: ') + x.name, 'aria-pressed': S.favs.has(x.id) ? 'true' : 'false' });
    fav.addEventListener('click', () => toggleFav(x));
    const like = el('button', { type: 'button', class: 'lyl-stat lyl-like' + (S.liked.has(x.id) ? ' on' : ''), html: ICON.heart + '<span>' + (x.likeCount || 0) + '</span>', 'aria-label': (S.liked.has(x.id) ? 'Unlike. ' : 'Like. ') + (x.likeCount || 0) + ' likes', 'aria-pressed': S.liked.has(x.id) ? 'true' : 'false' });
    like.addEventListener('click', () => toggleLike(x));
    const more = el('button', { type: 'button', class: 'lyl-ib', html: ICON.dots, 'aria-label': 'More for ' + x.name, 'aria-haspopup': 'menu' });
    more.addEventListener('click', () => menu(more, [
      x.ownerUid !== me().uid ? ['Report', () => report(x)] : null,
      S.admin ? [x.hidden ? 'Restore' : 'Hide from Browse', () => adminHide(x, !x.hidden)] : null,
      ['Copy name', () => navigator.clipboard && navigator.clipboard.writeText(x.name).then(() => toast('Copied'))]]));
    const lock = lockFor(x);
    return el('article', { class: 'lyl-card lyl-item' + (x.hidden ? ' dim' : ''), 'data-id': x.id }, [
      thumbEl(x),
      el('div', { class: 'lyl-mid' }, [
        el('div', { class: 'lyl-t' }, [txt('h3', '', x.name), isNew(x) ? txt('span', 'lyl-new', 'NEW') : null, x.visibility === 'community' ? txt('span', 'lyl-new lyl-cm', 'Community') : null]),
        el('p', { class: 'lyl-by', text: 'by ' + ownerHandle(x) + (S.admin && x.reportCount ? ' · ' + x.reportCount + ' report' + (x.reportCount === 1 ? '' : 's') : '') }),
        x.desc ? txt('p', 'lyl-d', x.desc) : null,
        el('div', { class: 'lyl-stats' }, [like, el('span', { class: 'lyl-stat', html: ICON.users + '<span>' + (x.useCount || 0) + '</span>', title: 'Members who used it', 'aria-label': (x.useCount || 0) + ' members used it' }),
          txt('span', 'lyl-stat', (x.indicators || 0) + (x.indicators === 1 ? ' indicator' : ' indicators'))]),
        (x.tags || []).length ? el('div', { class: 'lyl-tags' }, x.tags.slice(0, 3).map((t) => txt('span', '', '#' + t)).concat(x.tags.length > 3 ? [txt('span', 'more', '+' + (x.tags.length - 3))] : [])) : null,
        lock]),
      el('div', { class: 'lyl-act' }, [fav, actionBtn(x), more])]);
  }

  function carousel(list){
    const wrap = el('div', { class: 'lyl-car', tabindex: '0', 'aria-label': 'Trending layouts' });
    list.forEach((x) => {
      const a = actionBtn(x);
      wrap.appendChild(el('article', { class: 'lyl-big' }, [thumbEl(x, 'lyl-bth'),
        el('div', { class: 'lyl-bcap' }, [el('div', {}, [txt('h3', '', x.name), txt('p', '', 'by ' + ownerHandle(x))]), a])]));
    });
    return wrap;
  }

  const empty = (t, s, btn) => el('div', { class: 'lyl-empty' }, [txt('h3', '', t), txt('p', '', s), btn || null]);
  const primary = (t, fn) => { const b = el('button', { type: 'button', class: 'stkc-sbtn lyl-pri', text: t }); b.addEventListener('click', fn); return b; };
  const chip = (t, on, fn) => { const b = el('button', { type: 'button', class: 'lyl-chip' + (on ? ' on' : ''), text: t, 'aria-pressed': on ? 'true' : 'false' }); b.addEventListener('click', fn); return b; };
  function segSort(opts, cur, set){
    const s = el('select', { class: 'lyl-sel', 'aria-label': 'Sort' }, opts.map(([v, t]) => el('option', { value: v, text: t })));
    s.value = cur; s.addEventListener('change', () => set(s.value)); return s;
  }

  function viewBrowse(){
    const out = [];
    const sel = segSort([['trending', 'Trending'], ['new', 'New'], ['used', 'Most used']], S.sort, (v) => { S.sort = v; render(); });
    out.push(el('div', { class: 'lyl-bar' }, [txt('span', 'lyl-h', S.hiddenView ? 'Hidden layouts' : 'All layouts'), el('div', { class: 'lyl-bar-r' }, [S.admin ? chip(S.hiddenView ? 'Back to Browse' : 'Hidden', S.hiddenView, async () => { S.hiddenView = !S.hiddenView; await loadBrowse(); render(); }) : null, sel])]));
    if (S.err) { out.push(empty('Could not load', S.err, primary('Try again', async () => { await loadBrowse(); render(); }))); return out; }
    const all = S.items.filter(matches);
    if (!S.items.length) { out.unshift(empty('No layouts here yet', 'Publish a layout and it shows up here for every member.', primary('Publish your first layout', () => publishDialog()))); out.splice(1, 1); return out; }
    if (!all.length) { out.push(empty('No matches', 'Try a different name, author or tag.')); return out; }
    if (!S.q && !S.hiddenView) {
      const tr = S.items.slice().sort((p, q) => ((q.useCount || 0) * 2 + (q.likeCount || 0)) - ((p.useCount || 0) * 2 + (p.likeCount || 0)) || q.createdAt - p.createdAt).slice(0, 5);
      out.unshift(txt('p', 'lyl-h lyl-h0', 'Trending'), carousel(tr));
    }
    sortItems(all).forEach((x) => out.push(row(x)));
    return out;
  }

  function mineCard(x){
    const active = host.cur && host.cur.id === x.id;
    const more = el('button', { type: 'button', class: 'lyl-ib lyl-more', html: ICON.dots, 'aria-label': 'More for ' + x.name, 'aria-haspopup': 'menu' });
    const published = x.vis === 'public' || x.vis === 'community';
    const visL = { private: 'Private', link: 'Link only', public: 'Public', community: 'Community' }[x.vis] || 'Private';
    more.addEventListener('click', (e) => { e.stopPropagation(); menu(more, [
      ['Open', () => { closeSheet(); host.openById(x.id); }],
      ['Rename…', () => host.askName('Rename layout', x.name, async (n) => { await host.renameId(x.id, n); await loadMine(); render(); })],
      ['Duplicate', async () => { await host.duplicate(x.id); await loadMine(); render(); }],
      published ? ['Update published version', () => doPublish(x.id, x, { name: x.name, desc: x.desc || '', tags: x.tags || [], vis: x.vis, cid: x.cid || '' }).then(() => toast('Published version updated.')).catch(() => toast('Could not update the published version.', 'error'))] : null,
      published || x.vis === 'link' ? ['Unpublish', () => unpublish(x)] : ['Publish…', () => publishDialog(x.id)],
      ['Visibility…', () => publishDialog(x.id)],
      x.vis === 'link' ? ['Copy link', () => host.copyLink(x.id)] : null,
      { t: 'Delete', danger: true, run: async () => { if (await host.remove(x.id, x.name)) { await loadMine(); render(); } } }]); });
    const card = el('article', { class: 'lyl-mc' + (active ? ' active' : ''), tabindex: '0', role: 'button', 'aria-label': 'Open ' + x.name }, [
      el('div', { class: 'lyl-mth' }, [thumbEl(x, 'lyl-fill'), active ? el('span', { class: 'lyl-active', html: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M5 12l5 5 9-10"/></svg><span>ACTIVE</span>' }) : null, more]),
      txt('h3', '', x.name),
      txt('p', '', (x.panes || 1) + (x.panes === 1 || !x.panes ? ' pane' : ' panes') + ' · ' + (x.indicators || 0) + (x.indicators === 1 ? ' indicator' : ' indicators')),
      txt('p', 'lyl-vl', visL + ' · ' + host.ago(x.updatedAt))]);
    const go = () => { closeSheet(); host.openById(x.id); };
    card.addEventListener('click', go);
    card.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target === card) go(); });
    return card;
  }

  function viewMine(){
    const out = [];
    const sel = segSort([['recent', 'Recent'], ['name', 'Name']], S.mySort, (v) => { S.mySort = v; render(); });
    out.push(el('div', { class: 'lyl-bar' }, [el('div', { class: 'lyl-chips' }, [['all', 'All'], ['saved', 'Saved'], ['pub', 'Published']].map(([v, t]) => chip(t, S.filter === v, () => { S.filter = v; render(); }))), sel]));
    if (S.err) out.push(empty('Could not load', S.err));
    let l = S.mine.filter((x) => (S.filter === 'pub' ? x.vis === 'public' || x.vis === 'community' || x.vis === 'link' : S.filter === 'saved' ? !(x.vis === 'public' || x.vis === 'community' || x.vis === 'link') : true)).filter((x) => !S.q.trim() || x.name.toLowerCase().includes(S.q.trim().toLowerCase()));
    l.sort(S.mySort === 'name' ? (a, b) => a.name.localeCompare(b.name) : (a, b) => b.updatedAt - a.updatedAt);
    const grid = el('div', { class: 'lyl-grid' });
    const nw = el('button', { type: 'button', class: 'lyl-new-card', 'aria-label': 'New layout' }, [el('span', { class: 'lyl-nbox', html: ICON.plus }), txt('b', '', 'New layout')]);
    nw.addEventListener('click', () => host.askName('Create new layout', 'New layout', async (n) => { closeSheet(); await host.createNew(n); }));
    grid.appendChild(nw);
    l.forEach((x) => grid.appendChild(mineCard(x)));
    out.push(grid);
    if (!S.mine.length && !S.err) out.push(txt('p', 'lyl-hint', 'Save the chart you have open to see it here (Ctrl+S).'));
    return out;
  }

  function viewFavs(){
    const l = S.favItems.filter(matches);
    if (!S.favItems.length) return [empty('No favorites yet', 'Star a layout to save it here.')];
    if (!l.length) return [empty('No matches', 'Try a different name, author or tag.')];
    return l.map(row);
  }

  // ---------------------------------------------------------------- shell
  let tabOrder = ['browse', 'mine', 'favs'];
  function render(){
    if (!root) return;
    Object.keys(tabBtns).forEach((k) => { const on = S.tab === k; tabBtns[k].classList.toggle('on', on); tabBtns[k].setAttribute('aria-selected', on ? 'true' : 'false'); tabBtns[k].tabIndex = on ? 0 : -1; });
    hdrAct.hidden = S.tab !== 'mine';
    const scroll = bodyEl.scrollTop;
    bodyEl.innerHTML = '';
    const v = S.tab === 'browse' ? viewBrowse() : S.tab === 'mine' ? viewMine() : viewFavs();
    v.forEach((n) => n && bodyEl.appendChild(n));
    bodyEl.setAttribute('aria-busy', 'false');
    if (S.keep) { bodyEl.scrollTop = scroll; }
  }
  async function setTab(t){
    if (S.tab === t) return;
    S.tab = t; S.keep = false; bodyEl.scrollTop = 0;
    bodyEl.innerHTML = ''; bodyEl.appendChild(txt('p', 'lyl-hint', 'Loading…'));
    if (t === 'browse') { if (!S.items.length) await loadBrowse(); await loadFavIds(); }
    else if (t === 'mine') await loadMine();
    else await loadFavItems();
    S.keep = true; render();
  }

  async function open(tab){
    if (!me()) { toast('Sign in to use layouts.', 'error'); return; }
    if (root) root.remove();
    S.tab = '__'; S.q = ''; S.items = []; S.err = '';
    const back = el('div', { class: 'lyl-back' });
    const panel = el('div', { class: 'lyl-panel', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Layouts' });
    const close = el('button', { type: 'button', class: 'lyl-ib', html: ICON.x, 'aria-label': 'Close' });
    hdrAct = el('button', { type: 'button', class: 'lyl-pubbtn', html: ICON.up + '<span>Publish</span>' });
    hdrAct.addEventListener('click', () => publishDialog());
    const tabs = el('div', { class: 'lyl-tabs', role: 'tablist', 'aria-label': 'Layouts' });
    [['browse', 'Browse'], ['mine', 'My Layouts'], ['favs', 'Favorites']].forEach(([k, t]) => {
      const b = el('button', { type: 'button', class: 'lyl-tab', role: 'tab', text: t, id: 'lyl-tab-' + k }); b.addEventListener('click', () => setTab(k)); tabBtns[k] = b; tabs.appendChild(b);
    });
    tabs.addEventListener('keydown', (e) => { const i = tabOrder.indexOf(S.tab); if (e.key === 'ArrowRight' && i < 2) setTab(tabOrder[i + 1]); if (e.key === 'ArrowLeft' && i > 0) setTab(tabOrder[i - 1]); });
    bodyEl = el('div', { class: 'lyl-body', role: 'tabpanel', 'aria-live': 'polite' });
    searchEl = el('input', { type: 'search', class: 'lyl-search', placeholder: 'Search layouts', 'aria-label': 'Search layouts by name, author or tag', autocomplete: 'off', enterkeyhint: 'search' });
    searchEl.addEventListener('input', () => { S.q = searchEl.value; S.keep = false; render(); });
    const foot = el('div', { class: 'lyl-foot' }, [el('div', { class: 'lyl-sbox', html: ICON.search }, [searchEl])]);
    panel.appendChild(el('div', { class: 'lyl-grab', 'aria-hidden': 'true' }));
    panel.appendChild(el('div', { class: 'lyl-hd' }, [txt('h2', '', 'Layouts'), hdrAct, close]));
    panel.appendChild(tabs); panel.appendChild(bodyEl); panel.appendChild(foot);
    back.appendChild(panel); document.body.appendChild(back); root = back;

    const esc = (e) => { if (e.key === 'Escape' && !document.querySelector('.stkl-back')) { e.stopPropagation(); closeSheet(); } };
    closeSheet = () => { back.classList.remove('in'); document.removeEventListener('keydown', esc, true); setTimeout(() => { back.remove(); if (root === back) root = null; }, 200); };
    close.addEventListener('click', closeSheet);
    back.addEventListener('mousedown', (e) => { if (e.target === back) closeSheet(); });
    document.addEventListener('keydown', esc, true);
    requestAnimationFrame(() => back.classList.add('in'));
    // swipe between tabs (touch): a clear horizontal move, not inside the trending carousel
    let sx = 0, sy = 0, skip = false;
    bodyEl.addEventListener('touchstart', (e) => { const t = e.touches[0]; sx = t.clientX; sy = t.clientY; skip = !!e.target.closest('.lyl-car'); }, { passive: true });
    bodyEl.addEventListener('touchend', (e) => {
      if (skip) return; const t = e.changedTouches[0], dx = t.clientX - sx, dy = t.clientY - sy;
      if (Math.abs(dx) > 70 && Math.abs(dy) < 45) { const i = tabOrder.indexOf(S.tab); const n = dx < 0 ? i + 1 : i - 1; if (n >= 0 && n < 3) setTab(tabOrder[n]); }
    }, { passive: true });

    S.admin = await db().collection('admins').doc(me().uid).get().then((d) => d.exists).catch(() => false);
    S.tab = '__'; await setTab(tab || 'browse');
    if (!tab || tab === 'browse') searchEl.blur();
  }

  // Apply by id (community page → charts?applylayout=<id>); applyItem checks access via rules.
  async function applyId(id){
    if (!me()) { toast('Sign in to use layouts.', 'error'); return; }
    try { const d = await pub().doc(id).get(); if (!d.exists) throw 0; await applyItem(pubOf(d)); }
    catch (e) { toast('This layout is not available to you.', 'error'); }
  }
  const api = { open, state: S, blocked, publishDialog, applyId };
  window.STRYKER_LAYOUTS_LIB = api;
  return api;
}
