// TradeZoro — Admin support inbox: member tickets + legacy external messages.
// Depends on admin-guard.js, progress.js, pager.js, Firebase Functions compat.
'use strict';

let SUP_MESSAGES = [];
let SUP_FILTER = 'new';
let SUP_PAGER = null;
let TICKETS = [];
let TICKET_FILTER = 'attention';
let TICKET_SELECTED = null;
let TICKET_PAGER = null;
let TICKET_MSG_UNSUB = null;
let TICKET_FUNCTIONS = null;
let TICKET_MESSAGES = [];
let TICKET_LINK_FETCHED = Object.create(null);
let CONTACT_LINK_FETCHED = Object.create(null);

const TICKET_STATUS = { waiting_for_support:'Waiting for support', waiting_for_member:'Waiting for member', closed:'Closed' };
function supEsc(s){ return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }
function supWhen(ts){ return ts && typeof ts.toDate === 'function' ? ts.toDate().toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}) : 'Just now'; }
function supMillis(ts){ return ts && typeof ts.toMillis === 'function' ? ts.toMillis() : 0; }
function supError(err){ return (err && err.message ? err.message : String(err || 'Something went wrong.')).replace(/^Firebase:\s*/i,''); }
function ticketRequestId(){
  if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
  return 'req_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}
function ticketFormRequestId(form,fingerprint){
  if (!form.dataset.requestId || form.dataset.requestFingerprint !== fingerprint) {
    form.dataset.requestId = ticketRequestId(); form.dataset.requestFingerprint = fingerprint;
  }
  return form.dataset.requestId;
}
function ticketClearRequestId(form){ delete form.dataset.requestId; delete form.dataset.requestFingerprint; }
function ticketCall(data){
  if (!TICKET_FUNCTIONS) TICKET_FUNCTIONS = firebase.app().functions('us-central1');
  return TICKET_FUNCTIONS.httpsCallable('supportTicketAction')(data).then((r) => r.data || {});
}
function linkedTicket(){ const m = location.hash.match(/^#ticket-([A-Za-z0-9_-]+)$/); return m ? m[1] : null; }
function linkedContact(){ const m = location.hash.match(/^#contact-([A-Za-z0-9_-]+)$/); return m ? m[1] : null; }
function ticketById(id){ return TICKETS.find((t) => t.id === id); }

function selectTopTab(name){
  document.querySelectorAll('[data-support-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.supportTab === name)));
  document.getElementById('support-admin-tickets').hidden = name !== 'tickets';
  document.getElementById('support-admin-external').hidden = name !== 'external';
}

function renderTicketStats(){
  document.getElementById('ticket-stat-attention').textContent = TICKETS.filter((t) => t.adminAttention).length;
  document.getElementById('ticket-stat-member').textContent = TICKETS.filter((t) => t.status === 'waiting_for_member').length;
  document.getElementById('ticket-stat-closed').textContent = TICKETS.filter((t) => t.status === 'closed').length;
}
function filteredTickets(){
  if (TICKET_FILTER === 'attention') return TICKETS.filter((t) => t.adminAttention);
  if (TICKET_FILTER === 'open') return TICKETS.filter((t) => t.status !== 'closed');
  if (TICKET_FILTER === 'closed') return TICKETS.filter((t) => t.status === 'closed');
  return TICKETS.slice();
}
function renderTicketList(){
  const wrap = document.getElementById('ticket-admin-list');
  let rows = filteredTickets();
  if (!TICKET_PAGER && window.StrykerPager) TICKET_PAGER = StrykerPager.create({ after:wrap, label:'tickets', scrollTo:wrap, onChange:renderTicketList });
  if (TICKET_PAGER) {
    TICKET_PAGER.setTotal(rows.length);
    const linked = linkedTicket();
    if (linked && !TICKET_PAGER.__linked) {
      TICKET_PAGER.__linked = true;
      const at = rows.findIndex((t) => t.id === linked);
      if (at >= 0) { TICKET_PAGER.go(Math.floor(at / TICKET_PAGER.size) + 1); return; }
    }
    rows = TICKET_PAGER.slice(rows);
  }
  if (!rows.length) { wrap.innerHTML = '<p class="support-state">No tickets in this view.</p>'; return; }
  wrap.innerHTML = rows.map((t) => '<button type="button" class="support-ticket-row' + (TICKET_SELECTED === t.id ? ' is-active' : '') + '" data-ticket-id="' + supEsc(t.id) + '" aria-pressed="' + (TICKET_SELECTED === t.id) + '"><span class="support-row-top"><span class="support-row-subject">' + supEsc(t.subject) + '</span>' + (t.adminAttention ? '<span class="support-attention" aria-label="Needs attention"></span>' : '') + '</span><span class="support-row-meta">' + supEsc(t.ownerName || t.ownerEmail || t.ownerUid) + ' · ' + supEsc(t.category) + '</span><span class="support-status ' + supEsc(t.status) + '">' + supEsc(TICKET_STATUS[t.status] || t.status) + '</span><span class="support-row-preview">' + supEsc(t.lastMessagePreview || '') + '</span></button>').join('');
}
function renderAdminThread(ticket, messages){
  const wrap = document.getElementById('ticket-admin-thread');
  const body = messages.length ? messages.map((m) => '<article class="support-message ' + supEsc(m.senderRole) + '"><div class="support-message-meta">' + (m.senderRole === 'admin' ? 'Support' : supEsc(ticket.ownerName || ticket.ownerEmail || 'Member')) + ' · ' + supEsc(supWhen(m.createdAt)) + '</div><div class="support-message-body">' + supEsc(m.body) + '</div></article>').join('') : '<p class="support-state">No messages found.</p>';
  wrap.innerHTML = '<div class="support-thread-head"><div class="support-thread-title"><h2 tabindex="-1">' + supEsc(ticket.subject) + '</h2><p>' + supEsc(ticket.ownerEmail || ticket.ownerUid) + ' · ' + supEsc(ticket.category) + '</p></div><select id="ticket-admin-status" aria-label="Ticket status"><option value="waiting_for_support"' + (ticket.status === 'waiting_for_support' ? ' selected' : '') + '>Waiting for support</option><option value="waiting_for_member"' + (ticket.status === 'waiting_for_member' ? ' selected' : '') + '>Waiting for member</option><option value="closed"' + (ticket.status === 'closed' ? ' selected' : '') + '>Closed</option></select></div><div class="support-messages" id="ticket-admin-messages" tabindex="0" aria-label="Ticket conversation">' + body + '</div><form class="support-reply" id="ticket-admin-reply"><div class="field"><label for="ticket-admin-reply-text">Reply as support</label><textarea id="ticket-admin-reply-text" maxlength="4000" required placeholder="Write a reply…"></textarea></div><p class="support-error" id="ticket-admin-error" role="alert" hidden></p><div class="support-form-actions"><button type="submit" class="btn btn-primary">Send reply</button></div></form>';
  const box = document.getElementById('ticket-admin-messages'); if (box) box.scrollTop = box.scrollHeight;
}
function openAdminTicket(id, focus){
  const ticket = ticketById(id); if (!ticket) return;
  TICKET_SELECTED = id; history.replaceState(null,'','#ticket-' + id); renderTicketList();
  document.getElementById('ticket-admin-thread').innerHTML = '<p class="support-state">Loading conversation…</p>';
  if (TICKET_MSG_UNSUB) TICKET_MSG_UNSUB();
  TICKET_MSG_UNSUB = db.collection('supportTickets').doc(id).collection('messages').orderBy('createdAt','asc').onSnapshot((snap) => {
    TICKET_MESSAGES = snap.docs.map((d) => Object.assign({id:d.id},d.data()));
    renderAdminThread(ticketById(id) || ticket, TICKET_MESSAGES);
    if (focus) { const h = document.querySelector('#ticket-admin-thread h2'); if (h) { h.focus(); document.getElementById('ticket-admin-thread').scrollIntoView({block:'start'}); } focus = false; }
  }, (err) => { document.getElementById('ticket-admin-thread').innerHTML = '<p class="support-state support-error">Could not load conversation: ' + supEsc(supError(err)) + '</p>'; });
  if (ticket.adminAttention) ticketCall({action:'markRead',ticketId:id,expectedUpdatedAt:supMillis(ticket.updatedAt)}).catch(() => {});
}

function supRenderStats(){
  document.getElementById('sup-stat-new').textContent = SUP_MESSAGES.filter((m) => (m.status || 'new') === 'new').length;
  document.getElementById('sup-stat-handled').textContent = SUP_MESSAGES.filter((m) => m.status === 'handled').length;
  document.getElementById('sup-stat-total').textContent = SUP_MESSAGES.length;
}
function supRenderList(){
  const wrap = document.getElementById('sup-list');
  if (!SUP_PAGER && window.StrykerPager) SUP_PAGER = StrykerPager.create({after:wrap,label:'messages',scrollTo:wrap,onChange:supRenderList});
  let shown = SUP_MESSAGES.filter((m) => SUP_FILTER === 'all' || (m.status || 'new') === SUP_FILTER);
  if (SUP_PAGER) {
    SUP_PAGER.setTotal(shown.length);
    if (!SUP_PAGER.__linked && location.hash.indexOf('#contact-') === 0) {
      SUP_PAGER.__linked = true; const at = shown.findIndex((m) => 'contact-' + m.id === location.hash.slice(1));
      if (at >= 0) { SUP_PAGER.go(Math.floor(at / SUP_PAGER.size) + 1); return; }
    }
    shown = SUP_PAGER.slice(shown);
  }
  if (!shown.length) { wrap.innerHTML = '<p class="support-state">' + (SUP_FILTER === 'new' ? 'Inbox zero — nothing waiting on you.' : 'Nothing here yet.') + '</p>'; return; }
  wrap.innerHTML = shown.map((m) => { const st = m.status || 'new'; return '<div class="record-card sup-msg' + (st === 'handled' ? ' is-handled' : '') + '" id="contact-' + supEsc(m.id) + '"><div style="flex:1;min-width:0"><span class="cell-name">' + supEsc(m.name || 'Unknown') + ' <span class="status-tag ' + (st === 'handled' ? 'active' : 'trial') + '">' + (st === 'handled' ? 'Handled' : 'New') + '</span></span><span class="cell-sub">' + supEsc(m.email || '—') + ' · ' + supEsc(supWhen(m.createdAt)) + '</span><p style="font-size:13px;color:var(--ink-2);margin:8px 0 0;white-space:pre-wrap">' + supEsc(m.message || '') + '</p></div><div style="display:flex;flex-direction:column;gap:8px;flex-shrink:0">' + (m.email ? '<a class="btn btn-ghost btn-sm" href="mailto:' + supEsc(m.email) + '?subject=' + encodeURIComponent('Re: your message to TradeZoro') + '">Reply</a>' : '') + '<button type="button" class="btn ' + (st === 'handled' ? 'btn-ghost' : 'btn-primary') + ' btn-sm" data-sup-act="' + (st === 'handled' ? 'reopen' : 'handle') + '" data-id="' + supEsc(m.id) + '">' + (st === 'handled' ? 'Reopen' : 'Mark handled') + '</button></div></div>'; }).join('');
  if (location.hash.indexOf('#contact-') === 0) { const target = document.getElementById(location.hash.slice(1)); if (target) { target.scrollIntoView({block:'center'}); target.classList.add('record-card-flash'); setTimeout(() => target.classList.remove('record-card-flash'),2400); } }
}
function supSetStatus(id,status){
  const patch = {status};
  if (status === 'handled') { patch.handledAt = firebase.firestore.FieldValue.serverTimestamp(); patch.handledByUid = auth.currentUser ? auth.currentUser.uid : null; }
  else { patch.handledAt = null; patch.handledByUid = null; }
  return db.collection('contactMessages').doc(id).set(patch,{merge:true}).then(() => { const m = SUP_MESSAGES.find((x) => x.id === id); if (m) m.status = status; supRenderStats(); supRenderList(); if (typeof showToast === 'function') showToast('success',status === 'handled' ? 'Marked handled.' : 'Reopened.'); }).catch((err) => { if (typeof showToast === 'function') showToast('error','Could not update: ' + supError(err)); });
}

function initSupportAdmin(){
  const linked = linkedTicket();
  if (linked) { TICKET_FILTER = 'all'; selectTopTab('tickets'); }
  else if (location.hash.indexOf('#contact-') === 0) { SUP_FILTER = 'all'; selectTopTab('external'); }
  document.querySelectorAll('[data-ticket-filter]').forEach((b) => b.setAttribute('aria-selected',String(b.dataset.ticketFilter === TICKET_FILTER)));
  document.querySelectorAll('#sup-filter .term-cat').forEach((b) => b.classList.toggle('is-on',b.dataset.f === SUP_FILTER));

  db.collection('supportTickets').orderBy('updatedAt','desc').limit(200).onSnapshot((snap) => {
    TICKETS = snap.docs.map((d) => Object.assign({id:d.id},d.data()));
    const want = linkedTicket();
    if (want && !ticketById(want) && !TICKET_LINK_FETCHED[want]) {
      // A deep-linked ticket older than the newest 200 is fetched directly so the link still opens it.
      TICKET_LINK_FETCHED[want] = true;
      db.collection('supportTickets').doc(want).get().then((d) => { if (d.exists && !ticketById(d.id)) { TICKETS.push(Object.assign({id:d.id},d.data())); renderTicketStats(); renderTicketList(); if (TICKET_SELECTED !== d.id) openAdminTicket(d.id,true); } }).catch(() => {});
    }
    renderTicketStats(); renderTicketList();
    const target = linkedTicket();
    if (target && ticketById(target) && TICKET_SELECTED !== target) openAdminTicket(target,true);
    else if (TICKET_SELECTED && ticketById(TICKET_SELECTED) && TICKET_MESSAGES.length) renderAdminThread(ticketById(TICKET_SELECTED),TICKET_MESSAGES);
  }, (err) => { document.getElementById('ticket-admin-list').innerHTML = '<p class="support-state support-error">Could not load tickets: ' + supEsc(supError(err)) + '</p>'; });

  db.collection('contactMessages').orderBy('createdAt','desc').limit(200).get().then((snap) => { SUP_MESSAGES = snap.docs.map((d) => Object.assign({id:d.id},d.data())); const wantC = linkedContact(); if (wantC && !SUP_MESSAGES.some((m) => m.id === wantC) && !CONTACT_LINK_FETCHED[wantC]) { CONTACT_LINK_FETCHED[wantC] = true; return db.collection('contactMessages').doc(wantC).get().then((d) => { if (d.exists) SUP_MESSAGES.push(Object.assign({id:d.id},d.data())); }).catch(() => {}).then(() => { supRenderStats(); supRenderList(); }); } supRenderStats(); supRenderList(); }).catch((err) => { document.getElementById('sup-list').innerHTML = '<p class="support-state support-error">Could not load external messages: ' + supEsc(supError(err)) + '</p>'; });

  document.querySelector('[aria-label="Support inbox"]').addEventListener('click',(e) => { const b = e.target.closest('[data-support-tab]'); if (b) selectTopTab(b.dataset.supportTab); });
  document.getElementById('ticket-filter').addEventListener('click',(e) => { const b = e.target.closest('[data-ticket-filter]'); if (!b) return; TICKET_FILTER = b.dataset.ticketFilter; if (TICKET_PAGER) TICKET_PAGER.reset(); document.querySelectorAll('[data-ticket-filter]').forEach((x) => x.setAttribute('aria-selected',String(x === b))); renderTicketList(); });
  document.getElementById('ticket-admin-list').addEventListener('click',(e) => { const b = e.target.closest('[data-ticket-id]'); if (b) openAdminTicket(b.dataset.ticketId,true); });
  document.getElementById('ticket-admin-thread').addEventListener('submit',(e) => { if (e.target.id !== 'ticket-admin-reply') return; e.preventDefault(); const form = e.target, field = document.getElementById('ticket-admin-reply-text'), error = document.getElementById('ticket-admin-error'); error.hidden = true; Array.from(form.elements).forEach((x) => x.disabled = true); const payload = {action:'reply',ticketId:TICKET_SELECTED,message:field.value}; payload.requestId = ticketFormRequestId(form,[TICKET_SELECTED,field.value].join('\u0000')); ticketCall(payload).then(() => { ticketClearRequestId(form); field.value = ''; if (typeof showToast === 'function') showToast('success','Reply sent.'); }).catch((err) => { error.textContent = supError(err); error.hidden = false; }).finally(() => Array.from(form.elements).forEach((x) => x.disabled = false)); });
  document.getElementById('ticket-admin-thread').addEventListener('change',(e) => { if (e.target.id !== 'ticket-admin-status') return; const select = e.target; select.disabled = true; ticketCall({action:'status',ticketId:TICKET_SELECTED,status:select.value,requestId:ticketRequestId()}).catch((err) => { if (typeof showToast === 'function') showToast('error',supError(err)); }).finally(() => { select.disabled = false; }); });
  document.getElementById('sup-filter').addEventListener('click',(e) => { const b = e.target.closest('.term-cat'); if (!b) return; SUP_FILTER = b.dataset.f; if (SUP_PAGER) SUP_PAGER.reset(); document.querySelectorAll('#sup-filter .term-cat').forEach((x) => x.classList.toggle('is-on',x === b)); supRenderList(); });
  document.getElementById('sup-list').addEventListener('click',(e) => { const b = e.target.closest('[data-sup-act]'); if (!b) return; b.disabled = true; supSetStatus(b.dataset.id,b.dataset.supAct === 'handle' ? 'handled' : 'new'); });
}

document.addEventListener('DOMContentLoaded',() => guardAdminPage(initSupportAdmin));
