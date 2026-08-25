// Stryker Trading Academy — student Invite & Earn page (referrals.html)
// Depends on: assets/auth.js, assets/progress.js (`db`), assets/referrals.js

let REFERRAL_UID = null;

// Existing accounts have duplicate rows for a single invitee — one 'signed_up'
// row from the link and a second 'converted' row created at checkout, because
// the signup path used to abort before writing referredBy. The write path is
// fixed, but the bad rows are already in Firestore, so collapse them on read:
// one invitee is one entry, points summed, furthest-along status wins.
function collapseInvites(rawInvites){
  const byPerson = new Map();
  rawInvites.forEach((inv) => {
    // Rows with no referredUid can't be matched to a person; keep them separate.
    const key = inv.referredUid || ('anon:' + Math.random());
    const existing = byPerson.get(key);
    if (!existing) {
      byPerson.set(key, Object.assign({}, inv));
      return;
    }
    existing.pointsAwarded = (existing.pointsAwarded || 0) + (inv.pointsAwarded || 0);
    existing.signupPoints = (existing.signupPoints || 0) + (inv.signupPoints || 0);
    existing.conversionPoints = (existing.conversionPoints || 0) + (inv.conversionPoints || 0);
    if (inv.status === 'converted') existing.status = 'converted';
    existing.convertedPlan = existing.convertedPlan || inv.convertedPlan;
    existing.referredName = existing.referredName || inv.referredName;
    existing.referredEmail = existing.referredEmail || inv.referredEmail;
    const te = existing.createdAt && existing.createdAt.toMillis ? existing.createdAt.toMillis() : 0;
    const ti = inv.createdAt && inv.createdAt.toMillis ? inv.createdAt.toMillis() : 0;
    if (ti && (!te || ti < te)) existing.createdAt = inv.createdAt; // keep the earliest join date
  });
  return Array.from(byPerson.values());
}

// Guards against names stored as the literal string "null" by an older code
// path, which is why an invitee could render as "Null".
function inviteEscape(s){
  return String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function inviteDisplayName(inv){
  const candidates = [inv.referredName, inv.referredEmail];
  for (let i = 0; i < candidates.length; i++) {
    const v = candidates[i];
    if (v === null || v === undefined) continue;
    const s = String(v).trim();
    if (!s || s.toLowerCase() === 'null' || s.toLowerCase() === 'undefined') continue;
    return s;
  }
  return 'A new trader';
}

function renderInviteList(invites){
  const wrap = document.getElementById('referral-invite-list');
  const countEl = document.getElementById('referral-invite-count');
  if (countEl) countEl.textContent = invites.length + ' invite' + (invites.length === 1 ? '' : 's');

  if (!invites.length) {
    wrap.innerHTML = '<p style="color:var(--ink-3); font-size:13.5px;">No one has joined through your link yet — share it above to start earning points.</p>';
    return;
  }

  wrap.innerHTML = '';
  invites.forEach((inv) => {
    const when = inv.createdAt && typeof inv.createdAt.toDate === 'function'
      ? inv.createdAt.toDate().toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
      : '—';
    // Older rows predate the split and only carry a summed pointsAwarded.
    // Treat that whole total as signup points rather than showing zeroes,
    // which would read as though nothing had been earned at all.
    const hasSplit = (inv.signupPoints !== undefined) || (inv.conversionPoints !== undefined);
    const signupPts = hasSplit ? (inv.signupPoints || 0) : (inv.pointsAwarded || 0);
    const convPts = hasSplit ? (inv.conversionPoints || 0) : 0;
    const totalPts = (inv.pointsAwarded || 0) || (signupPts + convPts);

    const converted = inv.status === 'converted';
    const planNote = converted
      ? ('Upgraded' + (inv.convertedPlan ? ' to ' + inviteEscape(inv.convertedPlan) : ''))
      : 'Signed up — not upgraded yet';

    // Each earning event on its own line. A single merged figure made it
    // impossible to tell a signup bonus from an upgrade bonus, which is
    // exactly what hid the fact that upgrades were paying nothing.
    const lines =
      '<div class="invite-pts-line"><span>Signed up</span><b>+' + signupPts + '</b></div>' +
      (converted
        ? '<div class="invite-pts-line converted"><span>Upgrade</span><b>+' + convPts + '</b></div>'
        : '<div class="invite-pts-line pending"><span>Upgrade</span><b>—</b></div>');

    const card = document.createElement('div');
    card.className = 'record-card invite-row';
    card.innerHTML =
      '<div style="flex:1; min-width:0;">' +
        '<span class="cell-name">' + inviteDisplayName(inv) + '</span>' +
        '<div style="font-family:var(--font-mono); font-size:11.5px; color:var(--ink-3); margin-top:3px;">' + when + '</div>' +
        '<div style="font-family:var(--font-mono); font-size:11px; color:' + (converted ? '#03c988' : '#8b93a0') + '; margin-top:4px;">' + planNote + '</div>' +
      '</div>' +
      '<div class="invite-pts">' + lines +
        '<div class="invite-pts-total">' + totalPts + ' pts</div>' +
      '</div>';
    wrap.appendChild(card);
  });
}

function renderLeaderboard(list, myUid, myPoints){
  const wrap = document.getElementById('referral-leaderboard');
  const rankEl = document.getElementById('referral-rank');

  // Rank has to be resolved BEFORE any early return. This used to sit at the
  // bottom of the function, after a `return` taken when the list was empty —
  // so whenever the leaderboard came back empty the rank was simply never
  // written and stayed on its placeholder dash forever.
  const myIndex = list.findIndex((e) => e.uid === myUid);
  if (rankEl) {
    if (myIndex >= 0) rankEl.textContent = '#' + (myIndex + 1);
    else if (!myPoints) rankEl.textContent = '—';           // no points yet: genuinely unranked
    else rankEl.textContent = '#' + (list.length + 1) + '+'; // has points, outside the fetched top N
  }

  if (!list.length) {
    wrap.innerHTML = '<p style="color:var(--ink-3); font-size:13.5px;">No one has earned invite points yet — be the first.</p>';
    return;
  }
  wrap.innerHTML = '';
  list.forEach((entry, i) => {
    const isMe = entry.uid === myUid;
    const roleTag = (typeof roleTagHtml === 'function') ? roleTagHtml(entry.plan, { size: 'small' }) : '';
    const avatarHtml = (typeof avatarImgHtml === 'function') ? avatarImgHtml(entry.uid, entry.name, entry, 32, true) : '';
    const row = document.createElement('div');
    row.className = 'record-card';
    if (isMe) row.style.borderColor = 'var(--teal)';
    row.innerHTML =
      '<div style="display:flex; align-items:center; gap:12px; flex:1;">' +
        '<span style="font-family:var(--font-mono); font-size:14px; color:var(--ink-3); width:24px;">#' + (i + 1) + '</span>' +
        avatarHtml +
        '<span class="cell-name">' + entry.name + (isMe ? ' (you)' : '') + roleTag + '</span>' +
      '</div>' +
      '<div style="font-family:var(--font-mono); font-size:13px; color:#f5c542; font-weight:700;">' + entry.points + ' pts</div>';
    wrap.appendChild(row);
  });
}

function copyReferralLink(){
  const input = document.getElementById('referral-link-display');
  input.select();
  input.setSelectionRange(0, 99999);
  try {
    navigator.clipboard.writeText(input.value);
    const btn = document.getElementById('referral-copy-btn');
    const original = btn.textContent;
    btn.textContent = 'Copied!';
    setTimeout(() => { btn.textContent = original; }, 1500);
  } catch (e) {
    document.execCommand('copy');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  if (!auth) return;

  let handled = false;
  auth.onAuthStateChanged((user) => {
    if (handled) return;
    if (!user) {
      setTimeout(() => { if (!handled) goToLoginPreservingReturn(); }, 1500);
      return;
    }
    handled = true;
    REFERRAL_UID = user.uid;

    ensureReferralCode(user.uid, user.displayName, user.email)
      .then((code) => {
        document.getElementById('referral-code-display').textContent = code || '—';
        const link = referralLinkForCode(code);
        document.getElementById('referral-link-display').value = link;
      })
      .catch((err) => {
        document.getElementById('referral-error').textContent = 'Could not generate your invite link: ' + (err.message || err);
        document.getElementById('referral-error').style.display = 'block';
      });

    let myPoints = 0;
    const pointsReady = db.collection('students').doc(user.uid).get().then((doc) => {
      myPoints = doc.exists ? (doc.data().referralPoints || 0) : 0;
      document.getElementById('referral-total-points').textContent = myPoints;
      return myPoints;
    }).catch((err) => {
      console.error('Stryker: failed to load referral points', err);
      document.getElementById('referral-total-points').textContent = '0';
      return 0;
    });

    db.collection('referrals').where('referrerUid', '==', user.uid).get()
      .then((snap) => {
        const raw = [];
        snap.forEach((doc) => raw.push(doc.data()));
        // One invitee = one row, even if older data recorded them twice.
        const invites = collapseInvites(raw);
        invites.sort((a, b) => {
          const ta = a.createdAt && a.createdAt.toMillis ? a.createdAt.toMillis() : 0;
          const tb = b.createdAt && b.createdAt.toMillis ? b.createdAt.toMillis() : 0;
          return tb - ta;
        });
        // "People invited" counts PEOPLE, not referral documents.
        document.getElementById('referral-total-invites').textContent = invites.length;
        renderInviteList(invites);
      })
      .catch((err) => {
        console.error('Stryker: failed to load invites', err);
        document.getElementById('referral-invite-list').innerHTML =
          '<p style="color:var(--ink-3); font-size:13.5px;">Could not load your invites right now — try refreshing.</p>';
      });

    Promise.all([loadReferralLeaderboard(10), pointsReady, (typeof loadPlansForRoles === 'function' ? loadPlansForRoles() : Promise.resolve())])
      .then(([list, points]) => renderLeaderboard(list, user.uid, points))
      .catch((err) => {
        document.getElementById('referral-leaderboard').innerHTML =
          '<p style="color:var(--ink-3); font-size:13.5px;">Could not load the leaderboard: ' + (err.message || err) + '</p>';
      });
  });

  document.getElementById('referral-copy-btn').addEventListener('click', copyReferralLink);
});
