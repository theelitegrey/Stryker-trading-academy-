// Stryker Trading Academy — Charts: Publish Pine script to community library
// Depends on: firebase compat SDKs, assets/auth.js, assets/progress.js
// Exposes window.StrykerPublishDialog
//
// Opened from the My scripts panel with a script id.
// Publishes to pineLibrary/{randomId}, owned by the current user.
// Visibility: private (owner only), invite (share link), public (community list).
// Open source (default) or code hidden (editor won't show source; still readable from browser).

(function () {
  'use strict';

  const DESCRIPTION_MAX = 280;
  const TAGS_ALLOWED = ['scalping', 'trend', 'volume', 'levels', 'oscillator', 'ma', 'rsi', 'macd', 'bollinger', 'ichimoku'];
  const VISIBILITY_ENUM = ['private', 'invite', 'public'];
  const ID_CHARS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

  function randId(len) {
    let s = '';
    for (let i = 0; i < len; i++) s += ID_CHARS[Math.floor(Math.random() * ID_CHARS.length)];
    return s;
  }

  function fb() {
    return (typeof firebase !== 'undefined' && firebase.apps && firebase.apps.length) ? firebase : null;
  }

  function user() {
    const f = fb();
    try { return f && f.auth().currentUser; } catch (e) { return null; }
  }

  function col() {
    const f = fb();
    return f && f.firestore().collection('pineLibrary');
  }

  function err(msg) {
    const e = new Error(msg);
    e.userMessage = msg;
    return e;
  }

  function cleanName(n) {
    n = String(n || '').replace(/\s+/g, ' ').trim().slice(0, 60);
    if (!n) throw err('Give the script a name.');
    return n;
  }

  function cleanDesc(d) {
    d = String(d || '').trim().slice(0, DESCRIPTION_MAX);
    return d;
  }

  function cleanTags(t) {
    if (!Array.isArray(t)) t = [];
    const seen = new Set();
    const out = [];
    for (const tag of t) {
      const s = String(tag).toLowerCase().trim();
      if (TAGS_ALLOWED.includes(s) && !seen.has(s)) {
        out.push(s);
        seen.add(s);
      }
    }
    return out;
  }

  function buildDialog(scriptId, scriptName, scriptSource) {
    const div = document.createElement('div');
    div.className = 'stkc-dialog stkc-publish-dialog';

    // Form state
    let pubName = scriptName;
    let pubDesc = '';
    let pubTags = [];
    let pubVisibility = 'private';
    let pubOpenSource = true;
    let pubAgreed = false;

    const html = `
      <div class="stkc-dhead">
        <h3>Publish script</h3>
        <button class="stkc-dclose" aria-label="Close">×</button>
      </div>
      <div class="stkc-dbody">
        <div class="stkc-form">

          <div class="stkc-fgroup">
            <label>Script name *</label>
            <input type="text" class="stkc-in" maxlength="60" value="${escapeHtml(scriptName)}">
            <div class="stkc-note">Used in the Community library. 1–60 characters.</div>
          </div>

          <div class="stkc-fgroup">
            <label>Description</label>
            <textarea class="stkc-in stkc-ta" maxlength="${DESCRIPTION_MAX}" placeholder="Brief explanation of what this script does…"></textarea>
            <div class="stkc-note">Optional, ≤ ${DESCRIPTION_MAX} characters. This appears in search results.</div>
          </div>

          <div class="stkc-fgroup">
            <label>Tags</label>
            <div class="stkc-tags">
              ${TAGS_ALLOWED.map(tag => `<label class="stkc-tag-check"><input type="checkbox" data-tag="${tag}"> ${tag}</label>`).join('')}
            </div>
            <div class="stkc-note">Help others find your script. Choose up to ${TAGS_ALLOWED.length} tags.</div>
          </div>

          <div class="stkc-fgroup">
            <label>Who can use this script?</label>
            <div class="stkc-radio-group">
              <label class="stkc-radio-check"><input type="radio" name="vis" value="private" checked> <strong>Private:</strong> Only me (default)</label>
              <label class="stkc-radio-check"><input type="radio" name="vis" value="invite"> <strong>Invite only:</strong> Anyone with the share link</label>
              <label class="stkc-radio-check"><input type="radio" name="vis" value="public"> <strong>Public:</strong> Listed in Community indicators for all members</label>
            </div>
          </div>

          <div class="stkc-fgroup">
            <label class="stkc-checkbox">
              <input type="checkbox" checked>
              <span><strong>Allow others to see the code</strong> (open source). If unchecked, the code is hidden in the editor when others use it—<em>but a technical user can still read it from their browser or network inspector.</em></span>
            </label>
          </div>

          <div class="stkc-fgroup">
            <label class="stkc-checkbox">
              <input type="checkbox">
              <span>I wrote this script or have the right to share it. *</span>
            </label>
            <div class="stkc-note">Required to publish. Scripts are subject to Stryker's terms.</div>
          </div>

        </div>
      </div>

      <div class="stkc-dfooter">
        <button class="stkc-btn stkc-btn-cancel">Cancel</button>
        <button class="stkc-btn stkc-btn-primary stkc-btn-publish">Publish</button>
      </div>
    `;

    div.innerHTML = html;

    const inputs = {
      name: div.querySelector('input[maxlength="60"]'),
      desc: div.querySelector('textarea'),
      visibility: div.querySelectorAll('input[name="vis"]'),
      openSource: div.querySelector('label.stkc-checkbox input[type="checkbox"]'),
      agreed: div.querySelectorAll('label.stkc-checkbox input[type="checkbox"]')[1],
      tags: div.querySelectorAll('input[data-tag]'),
      closeBtn: div.querySelector('.stkc-dclose'),
      cancelBtn: div.querySelector('.stkc-btn-cancel'),
      publishBtn: div.querySelector('.stkc-btn-publish'),
    };

    // Update form state as inputs change
    inputs.name.addEventListener('change', (e) => { pubName = cleanName(e.target.value); });
    inputs.desc.addEventListener('change', (e) => { pubDesc = cleanDesc(e.target.value); });
    inputs.openSource.addEventListener('change', (e) => { pubOpenSource = e.target.checked; });
    inputs.agreed.addEventListener('change', (e) => { pubAgreed = e.target.checked; });
    inputs.visibility.forEach(r => r.addEventListener('change', (e) => { if (e.target.checked) pubVisibility = e.target.value; }));
    inputs.tags.forEach(c => c.addEventListener('change', () => {
      pubTags = [];
      inputs.tags.forEach(ch => { if (ch.checked) pubTags.push(ch.dataset.tag); });
    }));

    async function publish() {
      if (!pubAgreed) { showMsg('Please confirm you wrote this script or have the right to share it.'); return; }
      if (!pubName) { showMsg('Give the script a name.'); return; }

      inputs.publishBtn.disabled = true;
      const prog = showProgress();

      try {
        const u = user();
        if (!u) throw err('You must be signed in to publish.');

        const col2 = col();
        if (!col2) throw err('Firestore is not available.');

        const doc = {
          ownerUid: u.uid,
          authorName: u.displayName || u.email || 'Anonymous',
          name: pubName,
          description: pubDesc,
          tags: pubTags,
          visibility: pubVisibility,
          openSource: pubOpenSource,
          source: scriptSource,
          version: 1,
          createdAt: firebase.firestore.FieldValue.serverTimestamp(),
          updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
          addCount: 0,
          reportCount: 0,
          status: 'ok',
        };

        const newId = randId(24);
        await col2.doc(newId).set(doc);

        prog.ok(`Script published! ID: ${newId}`);
        setTimeout(() => { closeDialog(); }, 1500);
      } catch (e) {
        console.warn('Stryker: Publish failed', e);
        prog.fail(e.userMessage || 'Publish failed. Try again.');
      }
    }

    let progDiv = null;
    function showProgress() {
      if (!progDiv) {
        progDiv = document.createElement('div');
        progDiv.className = 'stkc-progress';
        div.parentNode.insertBefore(progDiv, div.nextSibling);
      }
      progDiv.innerHTML = '<div class="stkc-progress-msg stkc-working">Publishing…</div>';
      return {
        ok: (msg) => { progDiv.innerHTML = `<div class="stkc-progress-msg stkc-ok">${escapeHtml(msg)}</div>`; },
        fail: (msg) => { progDiv.innerHTML = `<div class="stkc-progress-msg stkc-fail">${escapeHtml(msg)}</div>`; inputs.publishBtn.disabled = false; },
      };
    }

    function showMsg(msg) {
      const p = document.createElement('p');
      p.className = 'stkc-form-error';
      p.textContent = msg;
      div.querySelector('.stkc-dbody').appendChild(p);
      setTimeout(() => { p.remove(); }, 4000);
    }

    function closeDialog() {
      div.remove();
      if (progDiv) progDiv.remove();
    }

    inputs.closeBtn.addEventListener('click', closeDialog);
    inputs.cancelBtn.addEventListener('click', closeDialog);
    inputs.publishBtn.addEventListener('click', publish);

    return div;
  }

  function escapeHtml(s) {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  window.StrykerPublishDialog = {
    open: function (scriptId, scriptName, scriptSource) {
      const dialog = buildDialog(scriptId, scriptName, scriptSource);
      document.body.appendChild(dialog);
      dialog.querySelector('input[maxlength="60"]').focus();
    },
  };
})();
