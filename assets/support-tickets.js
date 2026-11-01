// TradeZoro — member support tickets in the signed-in Help shell.
// Depends on auth.js, progress.js, Firebase Functions compat, notifications.js.
(function () {
  'use strict';

  var tickets = [];
  var selectedId = null;
  var functionsApi = null;
  var unsubscribeTickets = null;
  var unsubscribeMessages = null;
  var activeMessageTicket = null;
  var currentMessages = [];
  var currentUser = null;
  var STATUS = {
    waiting_for_support: 'Waiting for support',
    waiting_for_member: 'Waiting for you',
    closed: 'Closed'
  };

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c];
    });
  }
  function stamp(ts) {
    if (!ts || typeof ts.toDate !== 'function') return 'Just now';
    return ts.toDate().toLocaleString(undefined, { month:'short', day:'numeric', hour:'numeric', minute:'2-digit' });
  }
  function millis(ts) { return ts && typeof ts.toMillis === 'function' ? ts.toMillis() : 0; }
  function errorText(err) {
    return (err && err.message ? err.message : String(err || 'Something went wrong.')).replace(/^Firebase:\s*/i, '');
  }
  function makeRequestId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
    return 'req_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  }
  function formRequestId(form, fingerprint) {
    if (!form.dataset.requestId || form.dataset.requestFingerprint !== fingerprint) {
      form.dataset.requestId = makeRequestId();
      form.dataset.requestFingerprint = fingerprint;
    }
    return form.dataset.requestId;
  }
  function clearFormRequestId(form) {
    delete form.dataset.requestId;
    delete form.dataset.requestFingerprint;
  }
  function call(payload) {
    if (!functionsApi) functionsApi = firebase.app().functions('us-central1');
    return functionsApi.httpsCallable('supportTicketAction')(payload).then(function (r) { return r.data || {}; });
  }
  function hashTicket() {
    var match = location.hash.match(/^#ticket-([A-Za-z0-9_-]+)$/);
    return match ? match[1] : null;
  }
  function setHash(id) {
    if (id && location.hash !== '#ticket-' + id) history.replaceState(null, '', '#ticket-' + id);
  }

  function revealShell(user) {
    var member = document.getElementById('member-help-shell');
    var dock = document.getElementById('appnav-dock');
    document.body.classList.toggle('member-mode', !!user);
    document.body.classList.remove('help-auth-pending');
    member.hidden = !user;
    dock.hidden = !user;
    if (user) {
      document.querySelector('.skip-link').setAttribute('href', '#member-main');
      var name = document.querySelector('#member-help-shell .chip-name');
      if (name) name.textContent = user.displayName || user.email || 'Member';
    }
  }

  function renderList() {
    var wrap = document.getElementById('support-ticket-list');
    if (!wrap) return;
    if (!tickets.length) {
      wrap.innerHTML = '<p class="support-state">No tickets yet. Create one when you need help from the team.</p>';
      document.getElementById('support-thread').innerHTML = '<p class="support-state">Your conversation will appear here.</p>';
      return;
    }
    wrap.innerHTML = tickets.map(function (t) {
      var unread = !!t.memberUnread;
      return '<button type="button" class="support-ticket-row' + (selectedId === t.id ? ' is-active' : '') + '" data-ticket-id="' + esc(t.id) + '" aria-pressed="' + (selectedId === t.id) + '">' +
        '<span class="support-row-top"><span class="support-row-subject">' + esc(t.subject) + '</span>' + (unread ? '<span class="support-attention" aria-label="Unread update"></span>' : '') + '</span>' +
        '<span class="support-row-meta">' + esc(t.category) + ' · ' + esc(stamp(t.updatedAt)) + '</span>' +
        '<span class="support-status ' + esc(t.status) + '">' + esc(STATUS[t.status] || t.status) + '</span>' +
        '<span class="support-row-preview">' + esc(t.lastMessagePreview || '') + '</span>' +
      '</button>';
    }).join('');
  }

  function ticketById(id) { return tickets.find(function (t) { return t.id === id; }); }

  function renderThreadLoading(ticket) {
    var wrap = document.getElementById('support-thread');
    wrap.innerHTML = '<div class="support-thread-head"><div class="support-thread-title"><h2 tabindex="-1">' + esc(ticket.subject) + '</h2><p>' + esc(ticket.category) + '</p></div><span class="support-status ' + esc(ticket.status) + '">' + esc(STATUS[ticket.status]) + '</span></div><p class="support-state">Loading conversation…</p>';
  }

  function renderThread(ticket, messages) {
    var wrap = document.getElementById('support-thread');
    var closed = ticket.status === 'closed';
    var action = closed
      ? '<button type="button" class="btn btn-ghost" data-ticket-action="reopen">Reopen ticket</button>'
      : '<button type="button" class="btn btn-ghost" data-ticket-action="close">Close ticket</button>';
    var body = messages.length ? messages.map(function (m) {
      return '<article class="support-message ' + esc(m.senderRole) + '"><div class="support-message-meta">' + (m.senderRole === 'admin' ? 'TradeZoro support' : 'You') + ' · ' + esc(stamp(m.createdAt)) + '</div><div class="support-message-body">' + esc(m.body) + '</div></article>';
    }).join('') : '<p class="support-state">No messages found.</p>';
    wrap.innerHTML = '<div class="support-thread-head"><div class="support-thread-title"><h2 tabindex="-1">' + esc(ticket.subject) + '</h2><p>' + esc(ticket.category) + ' · opened ' + esc(stamp(ticket.createdAt)) + '</p></div><div>' + action + '</div></div>' +
      '<span class="support-status ' + esc(ticket.status) + '">' + esc(STATUS[ticket.status] || ticket.status) + '</span>' +
      '<div class="support-messages" id="support-messages" tabindex="0" aria-label="Ticket conversation">' + body + '</div>' +
      (closed ? '<p class="support-state">This ticket is closed. Reopen it or reply to continue.</p>' : '') +
      '<form class="support-reply" id="support-reply-form"><div class="field"><label for="support-reply">Reply</label><textarea id="support-reply" maxlength="4000" required placeholder="Write a reply…"></textarea></div><p class="support-error" id="support-reply-error" role="alert" hidden></p><div class="support-form-actions"><button type="submit" class="btn btn-primary">Send reply</button></div></form>';
    var messageBox = document.getElementById('support-messages');
    if (messageBox) messageBox.scrollTop = messageBox.scrollHeight;
  }

  function openTicket(id, focus) {
    var ticket = ticketById(id);
    if (!ticket) return;
    selectedId = id;
    setHash(id);
    renderList();
    if (ticket.memberUnread) call({ action:'markRead', ticketId:id, expectedUpdatedAt:millis(ticket.updatedAt) }).catch(function () {});
    if (activeMessageTicket === id) {
      renderThread(ticket, currentMessages);
      if (focus) {
        var existingHeading = document.querySelector('#support-thread h2');
        if (existingHeading) { existingHeading.focus(); document.getElementById('support-thread').scrollIntoView({ block:'start' }); }
      }
      return;
    }
    renderThreadLoading(ticket);
    if (unsubscribeMessages) unsubscribeMessages();
    activeMessageTicket = id;
    currentMessages = [];
    unsubscribeMessages = db.collection('supportTickets').doc(id).collection('messages').orderBy('createdAt', 'asc').onSnapshot(function (snap) {
      currentMessages = snap.docs.map(function (doc) { return Object.assign({ id:doc.id }, doc.data()); });
      var latest = ticketById(id) || ticket;
      renderThread(latest, currentMessages);
      if (focus) {
        var heading = document.querySelector('#support-thread h2');
        if (heading) { heading.focus(); document.getElementById('support-thread').scrollIntoView({ block:'start' }); }
        focus = false;
      }
    }, function (err) {
      document.getElementById('support-thread').innerHTML = '<p class="support-state support-error">Could not load this conversation: ' + esc(errorText(err)) + '</p>';
    });
  }

  function startTickets(user) {
    currentUser = user;
    if (unsubscribeTickets) unsubscribeTickets();
    unsubscribeTickets = db.collection('supportTickets').where('ownerUid', '==', user.uid).onSnapshot(function (snap) {
      tickets = snap.docs.map(function (doc) { return Object.assign({ id:doc.id }, doc.data()); });
      tickets.sort(function (a, b) { return millis(b.updatedAt) - millis(a.updatedAt); });
      var linked = hashTicket();
      if (linked && ticketById(linked)) selectedId = linked;
      if (selectedId && !ticketById(selectedId)) selectedId = null;
      renderList();
      if (selectedId) openTicket(selectedId, linked === selectedId);
    }, function (err) {
      document.getElementById('support-ticket-list').innerHTML = '<p class="support-state support-error">Could not load tickets: ' + esc(errorText(err)) + '</p>';
    });
  }

  function setBusy(form, busy) {
    Array.prototype.forEach.call(form.elements, function (el) { el.disabled = busy; });
  }

  document.addEventListener('DOMContentLoaded', function () {
    if (typeof auth === 'undefined' || !auth) return;
    auth.onAuthStateChanged(function (user) {
      revealShell(user);
      if (user) startTickets(user);
    });

    var createPanel = document.getElementById('support-create');
    document.getElementById('support-new-btn').addEventListener('click', function () {
      createPanel.hidden = false;
      document.getElementById('support-category').focus();
    });
    document.getElementById('support-create-cancel').addEventListener('click', function () {
      createPanel.hidden = true;
      document.getElementById('support-new-btn').focus();
    });
    document.getElementById('support-create-form').addEventListener('submit', function (event) {
      event.preventDefault();
      var form = event.currentTarget;
      var error = document.getElementById('support-create-error');
      error.hidden = true;
      setBusy(form, true);
      var createPayload = {
        action:'create',
        category:document.getElementById('support-category').value,
        subject:document.getElementById('support-subject').value,
        message:document.getElementById('support-message').value
      };
      var createFingerprint = [createPayload.category, createPayload.subject, createPayload.message].join('\u0000');
      createPayload.requestId = formRequestId(form, createFingerprint);
      call(createPayload).then(function (result) {
        clearFormRequestId(form);
        form.reset(); createPanel.hidden = true; selectedId = result.ticketId; setHash(selectedId);
        if (typeof showToast === 'function') showToast('success', 'Support ticket created.');
      }).catch(function (err) {
        error.textContent = errorText(err); error.hidden = false;
      }).finally(function () { setBusy(form, false); });
    });

    document.getElementById('support-ticket-list').addEventListener('click', function (event) {
      var button = event.target.closest('[data-ticket-id]');
      if (button) openTicket(button.dataset.ticketId, true);
    });

    document.getElementById('support-thread').addEventListener('submit', function (event) {
      if (event.target.id !== 'support-reply-form') return;
      event.preventDefault();
      var form = event.target;
      var field = document.getElementById('support-reply');
      var error = document.getElementById('support-reply-error');
      error.hidden = true; setBusy(form, true);
      var replyPayload = { action:'reply', ticketId:selectedId, message:field.value };
      replyPayload.requestId = formRequestId(form, [selectedId, field.value].join('\u0000'));
      call(replyPayload).then(function () {
        clearFormRequestId(form);
        field.value = '';
        if (typeof showToast === 'function') showToast('success', 'Reply sent.');
      }).catch(function (err) { error.textContent = errorText(err); error.hidden = false; }).finally(function () { setBusy(form, false); });
    });

    document.getElementById('support-thread').addEventListener('click', function (event) {
      var button = event.target.closest('[data-ticket-action]');
      if (!button || !selectedId) return;
      button.disabled = true;
      var status = button.dataset.ticketAction === 'close' ? 'closed' : 'waiting_for_support';
      call({ action:'status', ticketId:selectedId, status:status, requestId:makeRequestId() }).catch(function (err) {
        if (typeof showToast === 'function') showToast('error', errorText(err));
        button.disabled = false;
      });
    });

    window.addEventListener('hashchange', function () {
      var id = hashTicket();
      if (id && ticketById(id)) openTicket(id, true);
    });
  });
})();
