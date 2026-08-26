// Stryker Trading Academy — Bots admin
// Depends on: assets/auth.js, assets/progress.js (db), assets/team-identity.js
//
// bots/{botId}: {
//   type, name, enabled, config {…},
//   lastRunAt, lastStatus, lastError, publishedCount, createdAt
// }
//
// WHY A COLLECTION, NOT A SETTINGS DOC
// The tweet mirror originally lived in settings/twitterBot — one document, one
// bot. "Add more bots later" is impossible in that shape without rewriting both
// the function and the admin page each time. A collection makes a second bot a
// row rather than a release.
//
// THE TYPE REGISTRY is the other half. Each bot type declares its own fields
// here, and the form is GENERATED from that declaration. Adding a type later
// means appending one object — no new form markup, no new save handler, no new
// validation branch. Hand-writing a form per type is how admin panels become
// the thing nobody wants to touch.
//
// Bots write as Stryker Team, so this page is admin-only in the rules as well
// as in the UI. Anything here can publish to every student's feed.

var BOT_TYPES = {
  'twitter-mirror': {
    label: 'X / Twitter mirror',
    blurb: 'Publishes new posts from an X account to the Trading Floor as Stryker Team.',
    icon: 'M18 4l-5.5 7L18 20h-3.2l-4-5.4L6 20H4l5.9-7.4L4.3 4h3.3l3.6 5 3.9-5H18z',
    fields: [
      { key: 'screenName', label: 'X account', type: 'text', required: true,
        placeholder: 'handle without the @',
        help: 'The account to mirror. Omit the @.' },
      { key: 'maxPerRun', label: 'Max posts per run', type: 'number',
        def: 3, min: 1, max: 10,
        help: 'Caps a catch-up burst. A quiet account that suddenly posts '
            + 'twenty times should not flood the floor in one go.' },
      { key: 'maxAgeMinutes', label: 'Only post tweets from the last', type: 'number',
        def: 60, min: 5, max: 1440,
        help: 'Minutes. Anything older is marked seen and never published, so '
            + 'a new bot starts from now rather than replaying history. 60 '
            + 'gives a 30-minute schedule room to recover from a missed run.' },
      { key: 'category', label: 'Post to', type: 'select',
        options: [['propfirm', 'Prop firm feed'], ['general', 'Posts']],
        def: 'propfirm' },
      { key: 'includeReplies', label: 'Include replies', type: 'bool', def: false,
        help: 'Replies usually lack context out of their thread.' },
      { key: 'includeRetweets', label: 'Include retweets', type: 'bool', def: false },
      { key: 'avatarUrl', label: 'Profile picture', type: 'image',
        help: 'Shown on every post this bot makes. Square images work best. '
            + 'Left empty, the bot gets a generated avatar from its name.' }
    ]
  }
  // Future types drop in here. Nothing below this object needs to change.
};

var BOTS = [];

function botTypeDef(type) {
  return BOT_TYPES[type] || null;
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function relTime(ts) {
  if (!ts || !ts.toMillis) return 'never';
  var d = Date.now() - ts.toMillis();
  if (d < 60000) return 'just now';
  if (d < 3600000) return Math.floor(d / 60000) + 'm ago';
  if (d < 86400000) return Math.floor(d / 3600000) + 'h ago';
  return Math.floor(d / 86400000) + 'd ago';
}

// ---- Rendering -------------------------------------------------------------
function renderBots() {
  var host = document.getElementById('bots-list');
  if (!host) return;

  if (!BOTS.length) {
    host.innerHTML =
      '<div class="empty-state">' +
      '<h3>No bots yet</h3>' +
      '<p>Bots publish to the Trading Floor as Stryker Team. Add one to get started.</p>' +
      '</div>';
    return;
  }

  host.innerHTML = BOTS.map(function (b) {
    var def = botTypeDef(b.type);
    var statusCls = !b.enabled ? 'paused'
                  : (b.lastStatus === 'error' ? 'error'
                  : (b.lastRunAt ? 'ok' : 'pending'));
    var statusText = !b.enabled ? 'Paused'
                   : (b.lastStatus === 'error' ? 'Last run failed'
                   : (b.lastRunAt ? 'Running' : 'Awaiting first run'));

    return '' +
    '<div class="bot-card' + (b.enabled ? '' : ' is-paused') + '" data-id="' + esc(b.id) + '">' +
      '<div class="bot-card-head">' +
        '<span class="bot-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">' +
          '<path d="' + (def ? def.icon : 'M12 2v20') + '"/></svg></span>' +
        '<div class="bot-card-title">' +
          '<h3>' + esc(b.name || (def ? def.label : b.type)) + '</h3>' +
          '<span class="bot-type">' + esc(def ? def.label : b.type) + '</span>' +
        '</div>' +
        '<span class="bot-status ' + statusCls + '">' + statusText + '</span>' +
      '</div>' +

      '<div class="bot-meta">' +
        '<div><span>Last run</span><b>' + relTime(b.lastRunAt) + '</b></div>' +
        '<div><span>Published</span><b>' + (b.publishedCount || 0) + '</b></div>' +
        '<div><span>Source</span><b>' +
          esc(b.config && b.config.screenName ? '@' + b.config.screenName : '—') +
        '</b></div>' +
      '</div>' +

      // A failed run has to be visible HERE. A bot that quietly stopped
      // working looks identical to a bot with nothing to post, and the
      // difference only surfaces weeks later when someone asks why the feed
      // went quiet.
      (b.lastStatus === 'error' && b.lastError
        ? '<div class="bot-error"><b>Last error</b><span>' + esc(b.lastError) + '</span></div>'
        : '') +

      '<div class="bot-card-actions">' +
        '<button type="button" class="btn btn-ghost btn-sm" data-act="toggle">' +
          (b.enabled ? 'Pause' : 'Resume') + '</button>' +
        '<button type="button" class="btn btn-ghost btn-sm" data-act="edit">Edit</button>' +
        '<button type="button" class="btn btn-ghost btn-sm bot-danger" data-act="delete">Delete</button>' +
      '</div>' +
    '</div>';
  }).join('');
}

// ---- Form, generated from the type definition ------------------------------
function fieldHtml(f, value) {
  var v = (value === undefined || value === null) ? f.def : value;
  var id = 'bot-f-' + f.key;
  var input;

  if (f.type === 'image') {
    var preview = v
      ? '<img src="' + esc(v) + '" alt="" class="bot-avatar-preview">'
      : '<span class="bot-avatar-preview is-empty">—</span>';
    input =
      '<div class="bot-avatar-row">' +
        preview +
        '<div class="bot-avatar-controls">' +
          '<input type="file" id="' + id + '-file" accept="image/*" hidden>' +
          '<button type="button" class="btn btn-ghost btn-sm" data-pick="' + id + '">Choose image</button>' +
          (v ? '<button type="button" class="btn btn-ghost btn-sm bot-danger" data-clear="' + id + '">Remove</button>' : '') +
        '</div>' +
        '<input type="hidden" id="' + id + '" value="' + esc(v || '') + '">' +
      '</div>';
  } else if (f.type === 'bool') {
    input = '<label class="bot-switch"><input type="checkbox" id="' + id + '"' +
            (v ? ' checked' : '') + '><span></span></label>';
  } else if (f.type === 'select') {
    input = '<select id="' + id + '" class="input">' +
      f.options.map(function (o) {
        return '<option value="' + esc(o[0]) + '"' +
               (String(v) === o[0] ? ' selected' : '') + '>' + esc(o[1]) + '</option>';
      }).join('') + '</select>';
  } else if (f.type === 'number') {
    input = '<input type="number" id="' + id + '" class="input" value="' + esc(v) +
            '"' + (f.min != null ? ' min="' + f.min + '"' : '') +
            (f.max != null ? ' max="' + f.max + '"' : '') + '>';
  } else {
    input = '<input type="text" id="' + id + '" class="input" value="' + esc(v || '') +
            '" placeholder="' + esc(f.placeholder || '') + '">';
  }

  return '<div class="bot-field' + (f.type === 'bool' ? ' is-bool' : '') + '">' +
    '<label for="' + id + '">' + esc(f.label) +
      (f.required ? ' <em>required</em>' : '') + '</label>' +
    input +
    (f.help ? '<p class="bot-help">' + esc(f.help) + '</p>' : '') +
  '</div>';
}

function openBotModal(bot) {
  var isNew = !bot;
  var type = bot ? bot.type : Object.keys(BOT_TYPES)[0];
  var def = botTypeDef(type);
  var cfg = (bot && bot.config) || {};

  document.getElementById('bot-modal-title').textContent =
    isNew ? 'Add a bot' : 'Edit bot';
  document.getElementById('bot-modal-overlay').style.display = 'flex';
  document.getElementById('bot-modal-overlay').dataset.editing = bot ? bot.id : '';

  var typeSelect = Object.keys(BOT_TYPES).length > 1
    ? '<div class="bot-field"><label for="bot-f-type">Type</label>' +
      '<select id="bot-f-type" class="input"' + (isNew ? '' : ' disabled') + '>' +
        Object.keys(BOT_TYPES).map(function (k) {
          return '<option value="' + k + '"' + (k === type ? ' selected' : '') + '>' +
                 esc(BOT_TYPES[k].label) + '</option>';
        }).join('') +
      '</select>' +
      (isNew ? '' : '<p class="bot-help">A bot\'s type cannot be changed after ' +
                    'creation — its stored config belongs to that type.</p>') +
      '</div>'
    : '';

  document.getElementById('bot-modal-body').innerHTML =
    '<p class="bot-blurb">' + esc(def.blurb) + '</p>' +
    typeSelect +
    '<div class="bot-field"><label for="bot-f-name">Name</label>' +
      '<input type="text" id="bot-f-name" class="input" value="' +
      esc(bot ? bot.name : '') + '" placeholder="' + esc(def.label) + '"></div>' +
    def.fields.map(function (f) { return fieldHtml(f, cfg[f.key]); }).join('');
}

function closeBotModal() {
  document.getElementById('bot-modal-overlay').style.display = 'none';
}

function readForm(type) {
  var def = botTypeDef(type);
  var cfg = {}, missing = [];
  def.fields.forEach(function (f) {
    var el = document.getElementById('bot-f-' + f.key);
    if (!el) return;
    var v;
    if (f.type === 'bool') v = el.checked;
    else if (f.type === 'number') v = parseInt(el.value, 10);
    else v = el.value.trim();      // 'image' stores its data URL in a hidden input

    if (f.type === 'number' && (isNaN(v) || v < (f.min || 0))) v = f.def;
    if (f.required && !v) missing.push(f.label);
    // Tolerate a pasted @handle rather than rejecting it — the leading @ is
    // the single most likely thing to be typed here.
    if (f.key === 'screenName' && typeof v === 'string') v = v.replace(/^@/, '');
    cfg[f.key] = v;
  });
  return { config: cfg, missing: missing };
}

function saveBot() {
  var overlay = document.getElementById('bot-modal-overlay');
  var editingId = overlay.dataset.editing || '';
  var typeEl = document.getElementById('bot-f-type');
  var type = typeEl ? typeEl.value : Object.keys(BOT_TYPES)[0];

  var res = readForm(type);
  if (res.missing.length) {
    if (typeof showToast === 'function') {
      showToast('error', 'Missing: ' + res.missing.join(', '));
    }
    return;
  }

  var name = document.getElementById('bot-f-name').value.trim()
             || botTypeDef(type).label;

  var payload = { type: type, name: name, config: res.config };

  var p;
  if (editingId) {
    // merge, so lastRunAt / publishedCount written by the function survive
    // an edit made from this page.
    p = db.collection('bots').doc(editingId).set(payload, { merge: true });
  } else {
    payload.enabled = true;
    payload.publishedCount = 0;
    payload.lastStatus = null;
    payload.lastRunAt = null;
    payload.createdAt = firebase.firestore.FieldValue.serverTimestamp();
    p = db.collection('bots').add(payload);
  }

  p.then(function (ref) {
    // Write the bot's profile so its name and avatar resolve on every post it
    // has made, not only future ones — posts are keyed on the bot's uid, never
    // on its name, precisely so a rename propagates backwards.
    var id = editingId || (ref && ref.id);
    if (id && typeof botProfile === 'function') {
      db.collection('profiles').doc(botUid(id))
        .set(botProfile({ id: id, name: name, config: res.config }), { merge: true })
        .catch(function (err) {
          console.error('Stryker: could not write the bot profile', err);
        });
    }
    if (typeof logActivity === 'function') {
      logActivity(editingId ? 'bot.updated' : 'bot.created',
        (editingId ? 'Updated' : 'Created') + ' bot: ' + name);
    }
    if (typeof showToast === 'function') showToast('success', 'Bot saved.');
    closeBotModal();
    loadBots();
  }).catch(function (err) {
    if (typeof showToast === 'function') showToast('error', err.message || 'Could not save.');
  });
}

// ---- Data ------------------------------------------------------------------
function loadBots() {
  var host = document.getElementById('bots-list');
  if (host) host.innerHTML = '<div class="loading-state">Loading bots…</div>';

  return db.collection('bots').get().then(function (snap) {
    BOTS = [];
    snap.forEach(function (d) {
      var b = d.data(); b.id = d.id; BOTS.push(b);
    });
    BOTS.sort(function (a, b) {
      return (a.name || '').localeCompare(b.name || '');
    });
    renderBots();
  }).catch(function (err) {
    if (host) {
      host.innerHTML = '<div class="empty-state"><h3>Could not load bots</h3><p>' +
        esc(err.message) + '</p></div>';
    }
  });
}

function toggleBot(bot) {
  db.collection('bots').doc(bot.id).set({ enabled: !bot.enabled }, { merge: true })
    .then(function () {
      if (typeof logActivity === 'function') {
        logActivity('bot.toggled',
          (bot.enabled ? 'Paused' : 'Resumed') + ' bot: ' + (bot.name || bot.id));
      }
      loadBots();
    });
}

function deleteBot(bot) {
  if (!confirm('Delete "' + (bot.name || bot.id) + '"?\n\n' +
               'Posts it already published stay on the Trading Floor.')) return;
  db.collection('bots').doc(bot.id).delete().then(function () {
    if (typeof logActivity === 'function') {
      logActivity('bot.deleted', 'Deleted bot: ' + (bot.name || bot.id));
    }
    if (typeof showToast === 'function') showToast('success', 'Bot deleted.');
    loadBots();
  });
}

// ---- Wiring ----------------------------------------------------------------
document.addEventListener('DOMContentLoaded', function () {
  if (!document.getElementById('bots-list')) return;

  document.getElementById('bot-add-btn')
    .addEventListener('click', function () { openBotModal(null); });
  document.getElementById('bot-modal-close')
    .addEventListener('click', closeBotModal);
  document.getElementById('bot-modal-cancel')
    .addEventListener('click', closeBotModal);
  document.getElementById('bot-modal-save')
    .addEventListener('click', saveBot);

  // Delegated, because cards are re-rendered on every load and per-card
  // listeners would leak with each refresh.
  document.getElementById('bots-list').addEventListener('click', function (e) {
    var btn = e.target.closest('[data-act]');
    if (!btn) return;
    var card = btn.closest('.bot-card');
    var bot = BOTS.filter(function (b) { return b.id === card.dataset.id; })[0];
    if (!bot) return;
    var act = btn.getAttribute('data-act');
    if (act === 'toggle') toggleBot(bot);
    else if (act === 'edit') openBotModal(bot);
    else if (act === 'delete') deleteBot(bot);
  });

  if (typeof auth !== 'undefined' && auth) {
    var done = false;
    auth.onAuthStateChanged(function (user) {
      if (done || !user) return;
      done = true;
      loadBots();
    });
  }
});

// ---- Avatar upload ---------------------------------------------------------
//
// Downscaled to 256px and re-encoded as JPEG before storing.
//
// This is not a nicety. Firestore caps a document at 1MB, and a phone photo is
// several times that as base64 — the write would simply fail. Even a file that
// squeaked under the cap would be re-downloaded in full by every student on
// every page of the feed, to be displayed at 36 pixels. 256px covers every
// place the avatar is shown, including retina.

var BOT_AVATAR_PX = 256;
var BOT_AVATAR_QUALITY = 0.86;

function downscaleImage(file) {
  return new Promise(function (resolve, reject) {
    if (!/^image\//.test(file.type)) {
      reject(new Error('That file is not an image.'));
      return;
    }
    var reader = new FileReader();
    reader.onerror = function () { reject(new Error('Could not read the file.')); };
    reader.onload = function () {
      var img = new Image();
      img.onerror = function () { reject(new Error('That image could not be decoded.')); };
      img.onload = function () {
        // Square crop from the centre. Avatars render in a circle, so a
        // non-square source would be cropped by CSS anyway — doing it here
        // means what the admin previews is what students actually see.
        var side = Math.min(img.width, img.height);
        var sx = (img.width - side) / 2;
        var sy = (img.height - side) / 2;

        var canvas = document.createElement('canvas');
        canvas.width = BOT_AVATAR_PX;
        canvas.height = BOT_AVATAR_PX;
        var ctx = canvas.getContext('2d');
        ctx.drawImage(img, sx, sy, side, side, 0, 0, BOT_AVATAR_PX, BOT_AVATAR_PX);

        // JPEG rather than PNG: a photo as PNG is several times larger for no
        // visible gain at this size. Transparency is irrelevant in a circle.
        resolve(canvas.toDataURL('image/jpeg', BOT_AVATAR_QUALITY));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

// Delegated on the modal body, because fields are re-rendered on every open.
document.addEventListener('DOMContentLoaded', function () {
  var body = document.getElementById('bot-modal-body');
  if (!body) return;

  body.addEventListener('click', function (e) {
    var pick = e.target.closest('[data-pick]');
    if (pick) {
      document.getElementById(pick.getAttribute('data-pick') + '-file').click();
      return;
    }
    var clear = e.target.closest('[data-clear]');
    if (clear) {
      var id = clear.getAttribute('data-clear');
      document.getElementById(id).value = '';
      var row = clear.closest('.bot-avatar-row');
      row.querySelector('.bot-avatar-preview').outerHTML =
        '<span class="bot-avatar-preview is-empty">—</span>';
      clear.remove();
    }
  });

  body.addEventListener('change', function (e) {
    if (!e.target.matches('input[type="file"]')) return;
    var file = e.target.files && e.target.files[0];
    if (!file) return;
    var hiddenId = e.target.id.replace(/-file$/, '');

    downscaleImage(file).then(function (dataUrl) {
      document.getElementById(hiddenId).value = dataUrl;
      var row = e.target.closest('.bot-avatar-row');
      var prev = row.querySelector('.bot-avatar-preview');
      prev.outerHTML = '<img src="' + dataUrl + '" alt="" class="bot-avatar-preview">';
      if (!row.querySelector('[data-clear]')) {
        row.querySelector('.bot-avatar-controls').insertAdjacentHTML('beforeend',
          '<button type="button" class="btn btn-ghost btn-sm bot-danger" data-clear="' +
          hiddenId + '">Remove</button>');
      }
    }).catch(function (err) {
      if (typeof showToast === 'function') showToast('error', err.message);
    });
    e.target.value = '';   // allow re-picking the same file
  });
});
