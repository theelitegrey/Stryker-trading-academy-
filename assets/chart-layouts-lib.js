// ZoroCharts CHART LIBRARY (Owner order 2026-11-01. Roadmap: Save and share chart layouts) — ES module,
// loaded on first use by assets/chart-layouts.js, which hands in `host` (its own helpers).
//
// A bottom sheet on phones, a dialog with a left rail on desktop, three tabs: Discover · Mine · Starred.
// Cards open a detail view (preview, indicators + key settings, tags); Use layout / Copy to mine / Report live there.
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
  search: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" aria-hidden="true"><circle cx="11" cy="11" r="6.500"/><path d="M16 16l4.500 4.500"/></svg>',
  bookmark: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="M7 4h10a1 1 0 0 1 1 1v15l-6-4-6 4V5a1 1 0 0 1 1-1z"/></svg>',
  loop: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 12a8 8 0 0 1-14 5.300M4 12a8 8 0 0 1 14-5.300M18 3v4h-4M6 21v-4h4"/></svg>',
  back: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>',
  link: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" aria-hidden="true"><path d="M10 14a4 4 0 0 0 5.700 0l3-3a4 4 0 0 0-5.700-5.700l-1 1M14 10a4 4 0 0 0-5.700 0l-3 3a4 4 0 0 0 5.700 5.700l1-1"/></svg>',
  globe: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/></svg>',
  sliders: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" aria-hidden="true"><path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/></svg>',
  compass: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M15.500 8.500l-2 5-5 2 2-5z"/></svg>',
  layers: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="M12 4l9 5-9 5-9-5zM3 14l9 5 9-5"/></svg>',
  empty: '<svg width="56" height="56" viewBox="0 0 56 56" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="8" y="12" width="40" height="32" rx="6"/><path d="M15 36l8-8 6 5 10-12"/></svg>',
  bookmarkBig: '<svg width="56" height="56" viewBox="0 0 56 56" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 8h22a2 2 0 0 1 2 2v38l-13-9-13 9V10a2 2 0 0 1 2-2z"/><path d="M28 17v10M23 22h10"/></svg>'
};

export function mountLib(host){
  const { el, toast, db } = host;
  const pub = () => db().collection('publicLayouts');
  const me = () => host.user();
  const favCol = () => db().collection('students').doc(me().uid).collection('layoutFavs');

  const S = { tab: 'browse', topic: 'all', kind: 'all', ind: {}, detail: null, sort: 'trending', filter: 'all', mySort: 'recent', q: '', items: [], mine: [], favs: new Set(), liked: new Set(), favItems: [], hiddenView: false, admin: false, busy: false, err: '' };
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
    if (x.locked) return false;
    try {
      const d = await pub().doc(x.id).collection('data').doc('s').get();
      if (!d.exists) { toast('This layout is no longer available.', 'error'); return false; }
      const doc = await host.decodeState(d.data().state);
      if (!doc) { toast('This layout could not be read.', 'error'); return false; }
      // the card's kind decides: a setup card always merges (keeps the member's symbol, interval, drawings)
      if (isSetup(x)) doc.setup = true;
      const ok = await host.applyForeign(doc, x.name);
      if (!ok) return false;
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
      return true;
    } catch (e) {
      console.warn('TradeZoro: apply layout', e);
      toast(x.visibility === 'community' ? 'Join the community to use this layout.' : 'Could not apply this layout.', 'error');
      return false;
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
    try { await pub().doc(x.id).update({ hidden: hide }); toast(hide ? 'Hidden from Discover' : 'Restored'); S.items = S.items.filter((y) => y.id !== x.id); render(); }
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
    if (!me()) { toast('Sign in to share layouts.', 'error'); return; }
    if (!id) { // no layout yet: save the open chart first
      if (!host.cur) { host.askName('Save layout', 'My layout', async (n) => { await host.saveAsNew(n); if (host.cur) publishDialog(host.cur.id); }); return; }
      id = host.cur.id;
    }
    if (host.cur && host.cur.id === id && host.dirty) await host.saveNow(false);
    const snap = await host.col().doc(id).get();
    if (!snap.exists) { toast('That layout no longer exists.', 'error'); return; }
    const x = snap.data();
    const comms = await myCommunities();
    const pubNow = await pub().doc(id).get().then((d) => (d.exists ? d.data() : null)).catch(() => null);
    const f = { kind: (pubNow && pubNow.kind) || 'setup', vis: x.vis || (x.shared ? 'link' : 'private'), tags: (x.tags || []).slice(0, 5), cid: x.cid || (comms[0] && comms[0].id) || '' };

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

    // What to share (Owner 2026-11-01): a Setup by default; Whole chart for a "today's idea" share.
    const kindWrap = el('div', { class: 'lyl-vis lyl-kind', role: 'radiogroup', 'aria-label': 'What to share' });
    const incl = el('p', { class: 'stkc-note' });
    const KINDS = [['setup', 'Setup', 'Indicators, settings and panes. Works on any symbol. No drawings.'], ['chart', 'Whole chart', 'Everything, with symbol, interval and drawings. For today\'s idea.']];
    const paintKind = () => {
      kindWrap.innerHTML = '';
      KINDS.forEach(([v, t, s]) => {
        const b = el('button', { type: 'button', class: 'lyl-vopt' + (f.kind === v ? ' on' : ''), role: 'radio', 'aria-checked': f.kind === v ? 'true' : 'false', 'data-kind': v }, [el('b', { text: t }), el('small', { text: s })]);
        b.addEventListener('click', () => { f.kind = v; paintKind(); });
        kindWrap.appendChild(b);
      });
      incl.textContent = (f.kind === 'setup' ? 'Shared: indicators and their settings, colours and panes. Your symbol, interval and drawings stay private.' : 'Everything in the chart is included: symbol, interval, indicators and their settings, panes and drawings.') + ' Education only. Not financial advice.';
    };
    paintKind();
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
    const ok = el('button', { type: 'button', class: 'stkc-sbtn lyl-pri', text: 'Share' });
    const body = el('div', { class: 'stkl-body lyl-form' }, [
      el('label', { class: 'lyl-lbl', text: 'What to share' }), kindWrap,
      el('label', { class: 'lyl-lbl', text: 'Name' }), name,
      el('label', { class: 'lyl-lbl', text: 'Description' }), desc, cnt,
      el('label', { class: 'lyl-lbl', text: 'Tags (up to 5)' }), chips, custom,
      el('label', { class: 'lyl-lbl', text: 'Who can see it' }), visWrap, commBox, note, err, incl]);
    const m = host.modal('Share layout', body, el('div', { class: 'stkl-ft' }, [ok]));
    m.box.classList.add('lyl-dlg', 'lyl-pub');
    const bad = (t) => { err.hidden = false; err.textContent = t; ok.disabled = false; };

    ok.addEventListener('click', async () => {
      const nm = name.value.replace(/\s+/g, ' ').trim().slice(0, 60), ds = desc.value.replace(/\s+/g, ' ').trim().slice(0, 140);
      if (!nm) return bad('Give the layout a name.');
      if (f.vis !== 'private' && (blocked(nm) || blocked(ds) || f.tags.some(blocked))) return bad('Please remove offensive or adult words from the name, description or tags.');
      if (f.vis === 'community' && !f.cid) return bad('Create a community in Creator Hub first.');
      ok.disabled = true; err.hidden = true;
      try { await doPublish(id, x, { kind: f.kind, name: nm, desc: ds, tags: f.tags.slice(0, 5), vis: f.vis, cid: f.vis === 'community' ? f.cid : '' }); m.done(); }
      catch (e) { console.warn('TradeZoro: publish', e); bad(e.userMessage || 'Could not share. Check your connection and try again.'); }
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
    const state = cd.state, doc = await host.decodeState(state);
    const k = host.countOf(doc);
    const extra = { name: o.name, desc: o.desc, tags: o.tags, vis: o.vis, cid: o.cid, panes: k.panes, indicators: k.indicators };
    const wasShared = !!cd.shared;
    const ref = pub().doc(id);

    if (o.vis === 'public' || o.vis === 'community') {
      const author = await authorName();
      const ex = await ref.get().catch(() => ({ exists: false }));
      // kind: the dialog's choice; "Update shared version" keeps the card's (cards from before kinds were whole charts)
      const kind = o.kind || (ex.exists && ex.data().kind) || 'chart';
      const setup = kind === 'setup';
      // a setup never uploads symbol, interval or drawings (the rules refuse drawings in a setup's state)
      // (a setup stays plain JSON so the rules can check it; host.encodeState refuses one past the cap)
      const pubState = setup && doc ? await host.encodeState(JSON.stringify(host.setupOf(doc)), true) : state;
      const card = { kind, authorName: author, name: o.name, desc: o.desc, tags: o.tags, visibility: o.vis, communityId: o.cid, symbol: setup ? '' : cd.symbol || '', interval: setup ? '' : cd.interval || '', thumb: cd.thumb || '', panes: k.panes, indicators: k.indicators };
      // the layout doc first (rules need it to exist), then card + state in one batch
      await mine.set(Object.assign({ name: cd.name, state, symbol: cd.symbol || '', interval: cd.interval || '', shared: wasShared, updatedAt: host.ts(), thumb: cd.thumb || '' }, extra, { name: o.name }), { merge: true });
      const b = db().batch();
      if (ex.exists) b.update(ref, Object.assign({}, card, { updatedAt: host.ts() }));
      else b.set(ref, Object.assign({ ownerUid: me().uid }, card, { likeCount: 0, useCount: 0, reportCount: 0, hidden: false, createdAt: host.ts(), updatedAt: host.ts() }));
      b.set(ref.collection('data').doc('s'), { state: pubState, updatedAt: host.ts() });
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
    const topic = (S.topic === 'all' || (x.tags || []).includes(S.topic)) && (S.kind === 'all' || (S.kind === 'setup') === isSetup(x));
    return topic && (!q || String(x.name).toLowerCase().includes(q) || String(x.authorName).toLowerCase().includes(q) || (x.tags || []).some((t) => t.includes(q)));
  };

  const handleOf = (x) => (x.ownerUid === me().uid ? 'you' : '@' + String(x.authorName || 'member').toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 20));
  const symOf = (x) => [host.symLabel(x.symbol), host.tfLabel(x.interval)].filter(Boolean).join(' · ');
  const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');

  // Indicator names + key settings come from the layout's state doc (read on demand; community layouts need membership).
  const prettyName = (s) => { s = String(s || '').replace(/^stryker[._-]/i, '').replace(/[_-]+/g, ' ').trim(); return s.length <= 5 ? s.toUpperCase() : s.replace(/\b\w/g, (c) => c.toUpperCase()); };
  function indList(doc){
    const out = [];
    const add = (name, inp) => {
      if (!name) return;
      const keys = inp && typeof inp === 'object' ? Object.keys(inp).filter((k) => ['string', 'number', 'boolean'].includes(typeof inp[k])).slice(0, 3) : [];
      out.push({ n: prettyName(name), s: keys.map((k) => k + ' ' + inp[k]).join(' · ') });
    };
    ((doc && doc.charts) || []).forEach((c) => {
      const i = (c && c.indicators) || {};
      (i.natives || []).forEach((n) => { if (typeof n === 'string') { if (n !== 'volume') add(n); } else if (n && n.type !== 'volume') add(n.type || n.id || n.name, n.inputs || n.params || n.settings); });
      (i.manifest || []).forEach((m) => add(m && (m.name || m.title || m.id), m && (m.inputs || m.params)));
      const p = c && c.ext && c.ext['stryker.pine'];
      if (Array.isArray(p)) p.forEach((q) => add((q && (q.name || q.title)) || 'Pine script'));
    });
    return out.slice(0, 40);
  }
  async function loadInd(x){
    if (S.ind[x.id] !== undefined) return S.ind[x.id];
    let r = null;
    try {
      const d = await pub().doc(x.id).collection('data').doc('s').get();
      if (d.exists) r = indList(await host.decodeState(d.data().state));
    } catch (e) { r = null; }
    S.ind[x.id] = r; return r;
  }
  const indChips = (x, list) => {
    const wrap = el('div', { class: 'lyl-ind', 'data-ind': x.id });
    const n = x.indicators || 0;
    if (!list) { wrap.appendChild(txt('span', 'lyl-ic', n ? plural(n, 'indicator') : 'No indicators')); return wrap; }
    if (!list.length) { wrap.appendChild(txt('span', 'lyl-ic', 'No indicators')); return wrap; }
    list.slice(0, 2).forEach((i) => wrap.appendChild(txt('span', 'lyl-ic', i.n)));
    if (list.length > 2) wrap.appendChild(txt('span', 'lyl-ic more', '+' + (list.length - 2)));
    return wrap;
  };
  async function hydrate(items){
    const q = items.filter((x) => S.ind[x.id] === undefined).slice(0, 24);
    const work = async () => {
      while (q.length) {
        const x = q.shift(); const l = await loadInd(x);
        if (!root || !l) continue;
        root.querySelectorAll('[data-ind="' + x.id + '"]').forEach((w) => w.replaceWith(indChips(x, l)));
      }
    };
    await Promise.all([work(), work(), work()]);
  }

  function menu(anchor, items){
    const old = document.querySelector('.lyl-menu'); if (old) old.remove();
    const m = el('div', { class: 'lyl-menu', role: 'menu' });
    items.forEach((it) => {
      if (!it) return;
      if (it.sep) { m.appendChild(el('div', { class: 'lyl-msep', text: it.sep })); return; }
      const b = el('button', { type: 'button', role: it.on !== undefined ? 'menuitemradio' : 'menuitem', class: (it.danger ? 'danger ' : '') + (it.on ? 'on' : ''), text: it[0] || it.t });
      if (it.on !== undefined) b.setAttribute('aria-checked', it.on ? 'true' : 'false');
      b.addEventListener('click', () => { m.remove(); (it.run || it[1])(); }); m.appendChild(b);
    });
    root.querySelector('.lyl-panel').appendChild(m);
    const r = anchor.getBoundingClientRect(), p = root.querySelector('.lyl-panel').getBoundingClientRect();
    m.style.top = Math.max(8, Math.min(r.bottom - p.top + 4, p.height - m.offsetHeight - 8)) + 'px';
    m.style.left = Math.max(8, Math.min(r.right - p.left - 208, p.width - 216)) + 'px';
    const off = (e) => { if (!m.contains(e.target)) { m.remove(); document.removeEventListener('pointerdown', off, true); } };
    setTimeout(() => document.addEventListener('pointerdown', off, true), 0);
  }

  const isSetup = (x) => x.kind === 'setup';
  const kindTag = (x) => txt('span', 'lyl-kd' + (isSetup(x) ? ' k-setup' : ''), isSetup(x) ? 'Setup' : 'Chart idea');
  function useBtn(x, cls){
    const t = isSetup(x) ? 'Use setup' : 'Use layout';
    const b = el('button', { type: 'button', class: 'lyl-use ' + (cls || ''), text: t, 'aria-label': t + ' ' + x.name });
    b.addEventListener('click', (e) => { e.stopPropagation(); applyItem(x); });
    return b;
  }
  function lockFor(x){
    if (x.visibility !== 'community') return null;
    return el('a', { class: 'lyl-lock', href: 'c/' + encodeURIComponent(x.communityId), html: ICON.lock + '<span>Join the community to use</span>' });
  }
  function favBtn(x, cls){
    const on = S.favs.has(x.id);
    const b = el('button', { type: 'button', class: 'lyl-ib lyl-fav ' + (cls || '') + (on ? ' on' : ''), html: ICON.bookmark, 'aria-label': (on ? 'Remove from starred: ' : 'Star: ') + x.name, 'aria-pressed': on ? 'true' : 'false' });
    b.addEventListener('click', (e) => { e.stopPropagation(); toggleFav(x).then(() => { if (S.detail && S.detail.id === x.id) showDetail(x); }); });
    return b;
  }
  function likeBtn(x){
    const on = S.liked.has(x.id);
    const b = el('button', { type: 'button', class: 'lyl-stat lyl-like' + (on ? ' on' : ''), html: ICON.heart + '<span>' + (x.likeCount || 0) + '</span>', 'aria-label': (on ? 'Unlike. ' : 'Like. ') + plural(x.likeCount || 0, 'like'), 'aria-pressed': on ? 'true' : 'false' });
    b.addEventListener('click', (e) => { e.stopPropagation(); toggleLike(x).then(() => { if (S.detail && S.detail.id === x.id) showDetail(x); }); });
    return b;
  }
  const usesEl = (x) => el('span', { class: 'lyl-stat', html: ICON.loop + '<span>' + plural(x.useCount || 0, 'use') + '</span>', title: 'Members who used it' });

  function card(x){
    const th = thumbEl(x, 'lyl-fill');
    const sym = isSetup(x) ? 'Any symbol' : symOf(x);
    const c = el('article', { class: 'lyl-gc' + (x.hidden ? ' dim' : ''), 'data-id': x.id, tabindex: '0', role: 'button', 'aria-label': 'Details: ' + x.name }, [
      el('div', { class: 'lyl-gth' }, [th, kindTag(x), sym ? txt('span', 'lyl-sym', sym) : null, favBtn(x, 'lyl-bm')]),
      el('div', { class: 'lyl-gb' }, [
        txt('h3', '', x.name),
        el('p', { class: 'lyl-by' }, [document.createTextNode('by ' + handleOf(x) + (S.admin && x.reportCount ? ' · ' + plural(x.reportCount, 'report') : '')), isNew(x) ? el('span', { class: 'lyl-newd' }, [el('i'), document.createTextNode('New')]) : null, x.visibility === 'community' ? txt('span', 'lyl-cmt', 'Community') : null]),
        indChips(x, S.ind[x.id]),
        el('div', { class: 'lyl-stats' }, [usesEl(x), likeBtn(x)]),
        lockFor(x)]),
      el('div', { class: 'lyl-gf' }, [useBtn(x)])]);
    const go = () => showDetail(x);
    c.addEventListener('click', (e) => { if (!e.target.closest('button, a')) go(); });
    c.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target === c) go(); });
    return c;
  }

  const empty = (t, s, btn, icon) => el('div', { class: 'lyl-empty' }, [icon ? el('div', { class: 'lyl-eic', html: icon }) : null, txt('h3', '', t), txt('p', '', s), btn || null]);
  const primary = (t, fn) => { const b = el('button', { type: 'button', class: 'stkc-sbtn lyl-pri', text: t }); b.addEventListener('click', fn); return b; };
  const chip = (t, on, fn) => { const b = el('button', { type: 'button', class: 'lyl-chip' + (on ? ' on' : ''), text: t, 'aria-pressed': on ? 'true' : 'false' }); b.addEventListener('click', fn); return b; };

  const TOPICS = [['all', 'All'], ['order flow', 'Order flow'], ['gex', 'GEX'], ['scalping', 'Scalping'], ['swing', 'Swing'], ['futures', 'Futures'], ['crypto', 'Crypto']];
  function topicRow(){
    const known = TOPICS.map((t) => t[0]);
    const count = {}; S.items.forEach((x) => (x.tags || []).forEach((t) => { count[t] = (count[t] || 0) + 1; }));
    const extra = Object.keys(count).filter((t) => !known.includes(t) && count[t] > 1).sort((a, b) => count[b] - count[a]).slice(0, 4).map((t) => [t, t.charAt(0).toUpperCase() + t.slice(1)]);
    const kinds = [['setup', 'Setups'], ['chart', 'Chart ideas']].map(([v, t]) => chip(t, S.kind === v, () => { S.kind = S.kind === v ? 'all' : v; S.keep = false; render(); }));
    const topics = TOPICS.concat(extra).map(([v, t]) => chip(t, S.topic === v && (v !== 'all' || S.kind === 'all'), () => { S.topic = v; if (v === 'all') S.kind = 'all'; S.keep = false; render(); }));
    return el('div', { class: 'lyl-topics', role: 'group', 'aria-label': 'Filter' }, [topics[0]].concat(kinds, [el('span', { class: 'lyl-csep', 'aria-hidden': 'true' })], topics.slice(1)));
  }
  const grid = (list) => { const g = el('div', { class: 'lyl-grid' }, list.map(card)); setTimeout(() => hydrate(list), 0); return g; };

  function viewBrowse(){
    const out = [];
    if (S.hiddenView) out.push(txt('p', 'lyl-h', 'Hidden layouts (admin view)'));
    else out.push(topicRow());
    if (S.err) { out.push(empty('Could not load', S.err, primary('Try again', async () => { await loadBrowse(); render(); }))); return out; }
    if (!S.items.length) return [empty('The library is empty', 'Share a layout and it appears here for every member.', primary('Share your first layout', () => publishDialog()), ICON.empty)];
    const all = sortItems(S.items.filter(matches));
    if (!all.length) { out.push(empty('Nothing matches', 'Try another topic, name, author or tag.', null, ICON.empty)); return out; }
    out.push(grid(all));
    return out;
  }

  const VIS = {
    private: { t: 'Private', ic: 'lock' },
    link: { t: 'Link', ic: 'link' },
    public: { t: 'Public', ic: 'globe' },
    community: { t: 'Community', ic: 'users' }
  };
  const visPill = (v) => { const o = VIS[v] || VIS.private; return el('span', { class: 'lyl-vp v-' + (VIS[v] ? v : 'private'), html: ICON[o.ic] + '<span>' + o.t + '</span>' }); };

  function mineRow(x){
    const active = host.cur && host.cur.id === x.id;
    const published = x.vis === 'public' || x.vis === 'community';
    const more = el('button', { type: 'button', class: 'lyl-ib lyl-more', html: ICON.dots, 'aria-label': 'More for ' + x.name, 'aria-haspopup': 'menu' });
    more.addEventListener('click', (e) => { e.stopPropagation(); menu(more, [
      ['Open', () => { closeSheet(); host.openById(x.id); }],
      ['Rename…', () => host.askName('Rename layout', x.name, async (n) => { await host.renameId(x.id, n); await loadMine(); render(); })],
      ['Duplicate', async () => { await host.duplicate(x.id); await loadMine(); render(); }],
      published ? ['Update shared version', () => doPublish(x.id, x, { name: x.name, desc: x.desc || '', tags: x.tags || [], vis: x.vis, cid: x.cid || '' }).then(() => toast('Shared version updated.')).catch(() => toast('Could not update the shared version.', 'error'))] : null,
      ['Share…', () => publishDialog(x.id)],
      published || x.vis === 'link' ? ['Stop sharing', () => unpublish(x)] : null,
      x.vis === 'link' ? ['Copy link', () => host.copyLink(x.id)] : null,
      { t: 'Delete', danger: true, run: async () => { if (await host.remove(x.id, x.name)) { await loadMine(); render(); } } }]); });
    const meta = plural(x.panes || 1, 'pane') + ' · ' + plural(x.indicators || 0, 'indicator') + (x.updatedAt ? ' · edited ' + host.ago(x.updatedAt) : '');
    const r = el('article', { class: 'lyl-mr' + (active ? ' active' : ''), tabindex: '0', role: 'button', 'aria-label': 'Open ' + x.name }, [
      thumbEl(x, 'lyl-mth'),
      el('div', { class: 'lyl-mm' }, [
        el('div', { class: 'lyl-mt' }, [txt('h3', '', x.name), active ? txt('span', 'lyl-cur', 'Current') : null]),
        el('div', { class: 'lyl-mv' }, [visPill(x.vis || 'private')]),
        txt('p', '', meta)]),
      more]);
    const go = () => { closeSheet(); host.openById(x.id); };
    r.addEventListener('click', go);
    r.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target === r) go(); });
    return r;
  }

  function viewMine(){
    const out = [];
    out.push(el('div', { class: 'lyl-topics' }, [['all', 'All'], ['saved', 'Private'], ['pub', 'Shared']].map(([v, t]) => chip(t, S.filter === v, () => { S.filter = v; render(); }))));
    if (S.err) out.push(empty('Could not load', S.err));
    const shared = (x) => x.vis === 'public' || x.vis === 'community' || x.vis === 'link';
    const l = S.mine.filter((x) => (S.filter === 'pub' ? shared(x) : S.filter === 'saved' ? !shared(x) : true)).filter((x) => !S.q.trim() || x.name.toLowerCase().includes(S.q.trim().toLowerCase()));
    l.sort(S.mySort === 'name' ? (a, b) => a.name.localeCompare(b.name) : (a, b) => b.updatedAt - a.updatedAt);
    if (!S.mine.length && !S.err) out.push(empty('No saved layouts yet', 'Save the chart you have open and it shows up here.', primary('Save current chart', saveCurrent), ICON.empty));
    else if (!l.length) out.push(empty('Nothing here', 'No layouts match this filter.', null, ICON.empty));
    else out.push(el('div', { class: 'lyl-list' }, l.map(mineRow)));
    return out;
  }

  function viewFavs(){
    const l = sortItems(S.favItems.filter(matches));
    if (!S.favItems.length) return [empty('Nothing starred yet', 'Tap the bookmark on any layout.', null, ICON.bookmarkBig)];
    if (!l.length) return [empty('Nothing matches', 'Try another topic, name, author or tag.', null, ICON.empty)];
    return [topicRow(), grid(l)];
  }

  function saveCurrent(){
    host.askName('Save layout', 'My layout', async (n) => { await host.saveAsNew(n); await loadMine(); render(); });
  }

  // ---------------------------------------------------------------- detail view
  async function copyToMine(x){
    if (!isSetup(x)) { if (await applyItem(x)) await host.saveAsNew(String(x.name).slice(0, 52) + ' copy'); return; }
    // a setup is a template: store it with the member's templates (Pine guard first)
    const T = window.StrykerChartTemplates;
    try {
      const d = await pub().doc(x.id).collection('data').doc('s').get();
      const s = d.exists && host.sanitizeShared(await host.decodeState(d.data().state));
      if (!s || !T) throw new Error('read');
      s.doc.setup = true;
      await T.save(String(x.name).slice(0, 60), s.doc);
      toast('Saved to your templates.');
    } catch (e) { console.warn('TradeZoro: setup to templates', e); toast((e && e.userMessage) || 'Could not save the setup.', 'error'); }
  }
  function closeDetail(){
    const d = root && root.querySelector('.lyl-det'); if (d) d.remove(); S.detail = null;
  }
  async function showDetail(x){
    const panel = root.querySelector('.lyl-panel'); closeDetail(); S.detail = x;
    const mineOwn = x.ownerUid === me().uid;
    const back = el('button', { type: 'button', class: 'lyl-ib lyl-dback', html: ICON.back, 'aria-label': 'Back to the library' });
    back.addEventListener('click', closeDetail);
    const more = S.admin ? el('button', { type: 'button', class: 'lyl-ib', html: ICON.dots, 'aria-label': 'Admin actions', 'aria-haspopup': 'menu' }) : null;
    if (more) more.addEventListener('click', () => menu(more, [[x.hidden ? 'Restore' : 'Hide from Discover', () => adminHide(x, !x.hidden).then(closeDetail)]]));
    const indBox = el('div', { class: 'lyl-dind' });
    const sym = isSetup(x) ? 'Any symbol' : symOf(x);
    const body = el('div', { class: 'lyl-dbody' }, [
      el('div', { class: 'lyl-dprev' }, [thumbEl(x, 'lyl-fill'), kindTag(x), sym ? txt('span', 'lyl-sym', sym) : null]),
      el('div', { class: 'lyl-dhead' }, [el('div', {}, [txt('h3', '', x.name), el('p', { class: 'lyl-by' }, [document.createTextNode('by ' + handleOf(x) + (S.admin && x.reportCount ? ' · ' + plural(x.reportCount, 'report') : '')), isNew(x) ? el('span', { class: 'lyl-newd' }, [el('i'), document.createTextNode('New')]) : null, x.visibility === 'community' ? txt('span', 'lyl-cmt', 'Community') : null])]), favBtn(x)]),
      el('div', { class: 'lyl-stats' }, [usesEl(x), likeBtn(x), txt('span', 'lyl-stat', plural(x.panes || 1, 'pane'))]),
      x.desc ? txt('p', 'lyl-ddesc', x.desc) : txt('p', 'lyl-ddesc mute', 'No description.'),
      txt('p', 'lyl-fine', isSetup(x) ? 'Setup: indicators, settings and panes. Applies to the symbol and interval you have open and keeps your drawings.' : 'Chart idea: the whole chart, with its symbol, interval and drawings. Opens as a new unsaved layout.'),
      txt('h4', 'lyl-dh', 'Indicators'), indBox,
      (x.tags || []).length ? txt('h4', 'lyl-dh', 'Tags') : null,
      (x.tags || []).length ? el('div', { class: 'lyl-tags' }, x.tags.map((t) => txt('span', '', '#' + t))) : null,
      lockFor(x),
      txt('p', 'lyl-fine', 'Education only. Not financial advice.')]);
    const copy = el('button', { type: 'button', class: 'lyl-sec', text: isSetup(x) ? 'Save to my templates' : 'Copy to mine' }); copy.addEventListener('click', () => copyToMine(x));
    const rep = mineOwn ? null : el('button', { type: 'button', class: 'lyl-txt', text: 'Report' }); if (rep) rep.addEventListener('click', () => report(x));
    const det = el('div', { class: 'lyl-det', role: 'region', 'aria-label': 'Layout details' }, [
      el('div', { class: 'lyl-dhd' }, [back, txt('h2', '', 'Layout'), more]),
      body,
      el('div', { class: 'lyl-dft' }, [useBtn(x, 'lyl-use-pri'), el('div', { class: 'lyl-dft2' }, [copy, rep])])]);
    panel.appendChild(det);
    indBox.appendChild(txt('p', 'lyl-fine', 'Loading…'));
    const list = await loadInd(x);
    if (S.detail !== x) return;
    indBox.innerHTML = '';
    if (!list) indBox.appendChild(txt('p', 'lyl-fine', x.visibility === 'community' ? 'Join the community to see the indicator settings.' : (x.indicators ? plural(x.indicators, 'indicator') + '.' : 'Settings are not available.')));
    else if (!list.length) indBox.appendChild(txt('p', 'lyl-fine', 'This layout has no indicators.'));
    else list.forEach((i) => indBox.appendChild(el('div', { class: 'lyl-irow' }, [txt('b', '', i.n), i.s ? txt('span', '', i.s) : null])));
    back.focus();
  }

  // ---------------------------------------------------------------- shell
  const tabOrder = ['browse', 'mine', 'favs'];
  const filterMenu = () => {
    const mine = S.tab === 'mine';
    menu(filterBtn, mine
      ? [{ sep: 'Sort' }, Object.assign(['Recently edited', () => { S.mySort = 'recent'; render(); }], { on: S.mySort === 'recent' }), Object.assign(['Name A–Z', () => { S.mySort = 'name'; render(); }], { on: S.mySort === 'name' })]
      : [{ sep: 'Sort' }, Object.assign(['Trending', () => { S.sort = 'trending'; render(); }], { on: S.sort === 'trending' }), Object.assign(['Newest', () => { S.sort = 'new'; render(); }], { on: S.sort === 'new' }), Object.assign(['Most used', () => { S.sort = 'used'; render(); }], { on: S.sort === 'used' }),
        S.admin && S.tab === 'browse' ? { sep: 'Admin' } : null, S.admin && S.tab === 'browse' ? Object.assign([S.hiddenView ? 'Showing hidden' : 'Show hidden only', async () => { S.hiddenView = !S.hiddenView; await loadBrowse(); render(); }], { on: S.hiddenView }) : null]);
  };
  function render(){
    if (!root) return;
    Object.keys(tabBtns).forEach((k) => { const on = S.tab === k; tabBtns[k].classList.toggle('on', on); tabBtns[k].setAttribute('aria-selected', on ? 'true' : 'false'); tabBtns[k].tabIndex = on ? 0 : -1; });
    hdrAct.hidden = hdrMore.hidden = S.tab !== 'mine';
    searchEl.placeholder = S.tab === 'mine' ? 'Search my layouts' : 'Search name, author or tag';
    const scroll = bodyEl.scrollTop;
    bodyEl.innerHTML = '';
    const v = S.tab === 'browse' ? viewBrowse() : S.tab === 'mine' ? viewMine() : viewFavs();
    v.forEach((n) => n && bodyEl.appendChild(n));
    bodyEl.setAttribute('aria-busy', 'false');
    if (S.keep) { bodyEl.scrollTop = scroll; }
  }
  async function setTab(t){
    if (S.tab === t) return;
    closeDetail();
    S.tab = t; S.keep = false; bodyEl.scrollTop = 0;
    bodyEl.innerHTML = ''; { const w = txt('div', '', ''); if (window.skel) { w.innerHTML = skel.html('cards', 4); bodyEl.appendChild(w); } else bodyEl.appendChild(txt('p', 'lyl-hint', 'Loading…')); }
    if (t === 'browse') { if (!S.items.length) await loadBrowse(); await loadFavIds(); }
    else if (t === 'mine') await loadMine();
    else await loadFavItems();
    S.keep = true; render();
  }

  let filterBtn = null, hdrMore = null;
  async function open(tab){
    if (!me()) { toast('Sign in to use layouts.', 'error'); return; }
    if (root) root.remove();
    S.tab = '__'; S.q = ''; S.items = []; S.err = ''; S.topic = 'all'; S.detail = null;
    const back = el('div', { class: 'lyl-back' });
    const panel = el('div', { class: 'lyl-panel', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Chart Library' });
    const close = el('button', { type: 'button', class: 'lyl-ib', html: ICON.x, 'aria-label': 'Close' });
    hdrAct = el('button', { type: 'button', class: 'lyl-savebtn', html: ICON.plus + '<span class="lyl-long">Save current chart</span><span class="lyl-short">Save</span>', 'aria-label': 'Save current chart' });
    hdrAct.addEventListener('click', saveCurrent);
    hdrMore = el('button', { type: 'button', class: 'lyl-ib', html: ICON.dots, 'aria-label': 'More actions', 'aria-haspopup': 'menu' });
    hdrMore.addEventListener('click', () => menu(hdrMore, [
      ['Share…', () => publishDialog()],
      ['New blank layout', () => host.askName('Create new layout', 'New layout', async (n) => { closeSheet(); await host.createNew(n); })]]));
    const tabs = el('div', { class: 'lyl-tabs', role: 'tablist', 'aria-label': 'Chart Library' });
    [['browse', 'Discover', ICON.compass], ['mine', 'Mine', ICON.layers], ['favs', 'Starred', ICON.bookmark]].forEach(([k, t, ic]) => {
      const b = el('button', { type: 'button', class: 'lyl-tab', role: 'tab', id: 'lyl-tab-' + k, html: ic + '<span>' + t + '</span>' }); b.addEventListener('click', () => setTab(k)); tabBtns[k] = b; tabs.appendChild(b);
    });
    tabs.addEventListener('keydown', (e) => { const i = tabOrder.indexOf(S.tab); if (e.key === 'ArrowRight' && i < 2) setTab(tabOrder[i + 1]); if (e.key === 'ArrowLeft' && i > 0) setTab(tabOrder[i - 1]); });
    bodyEl = el('div', { class: 'lyl-body', role: 'tabpanel', 'aria-live': 'polite' });
    searchEl = el('input', { type: 'search', class: 'lyl-search', placeholder: 'Search name, author or tag', 'aria-label': 'Search the library by name, author or tag', autocomplete: 'off', enterkeyhint: 'search' });
    searchEl.addEventListener('input', () => { S.q = searchEl.value; S.keep = false; render(); });
    filterBtn = el('button', { type: 'button', class: 'lyl-ib lyl-filter', html: ICON.sliders, 'aria-label': 'Sort and filter', 'aria-haspopup': 'menu' });
    filterBtn.addEventListener('click', filterMenu);
    panel.appendChild(el('div', { class: 'lyl-grab', 'aria-hidden': 'true' }));
    panel.appendChild(el('div', { class: 'lyl-hd' }, [txt('h2', '', 'Chart Library'), hdrAct, hdrMore, close]));
    panel.appendChild(tabs);
    panel.appendChild(el('div', { class: 'lyl-bar' }, [el('div', { class: 'lyl-sbox', html: ICON.search }, [searchEl]), filterBtn]));
    panel.appendChild(bodyEl);
    back.appendChild(panel); document.body.appendChild(back); root = back;

    const esc = (e) => { if (e.key === 'Escape' && !document.querySelector('.stkl-back')) { e.stopPropagation(); if (S.detail) closeDetail(); else closeSheet(); } };
    closeSheet = () => { back.classList.remove('in'); document.removeEventListener('keydown', esc, true); setTimeout(() => { back.remove(); if (root === back) root = null; }, 200); };
    close.addEventListener('click', closeSheet);
    back.addEventListener('mousedown', (e) => { if (e.target === back) closeSheet(); });
    document.addEventListener('keydown', esc, true);
    requestAnimationFrame(() => back.classList.add('in'));
    // swipe between tabs (touch): a clear horizontal move, not inside the topic chip row
    let sx = 0, sy = 0, skip = false;
    bodyEl.addEventListener('touchstart', (e) => { const t = e.touches[0]; sx = t.clientX; sy = t.clientY; skip = !!e.target.closest('.lyl-topics'); }, { passive: true });
    bodyEl.addEventListener('touchend', (e) => {
      if (skip) return; const t = e.changedTouches[0], dx = t.clientX - sx, dy = t.clientY - sy;
      if (Math.abs(dx) > 70 && Math.abs(dy) < 45) { const i = tabOrder.indexOf(S.tab); const n = dx < 0 ? i + 1 : i - 1; if (n >= 0 && n < 3) setTab(tabOrder[n]); }
    }, { passive: true });

    S.admin = await db().collection('admins').doc(me().uid).get().then((d) => d.exists).catch(() => false);
    S.tab = '__'; await setTab(tab || 'browse');
  }

  // Use by id (community page → charts?applylayout=<id>); applyItem checks access via rules.
  async function applyId(id){
    if (!me()) { toast('Sign in to use layouts.', 'error'); return; }
    try { const d = await pub().doc(id).get(); if (!d.exists) throw 0; await applyItem(pubOf(d)); }
    catch (e) { toast('This layout is not available to you.', 'error'); }
  }
  const api = { open, state: S, blocked, publishDialog, applyId };
  window.STRYKER_LAYOUTS_LIB = api;
  return api;
}
