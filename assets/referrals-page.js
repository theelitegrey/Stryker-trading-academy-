// Stryker Trading Academy — student Invite & Earn page (referrals.html)
// Depends on: assets/auth.js, assets/progress.js (`db`), assets/referrals.js

let REFERRAL_UID = null;

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
    const statusColor = inv.status === 'converted' ? '#03c988' : '#8b93a0';
    const statusLabel = inv.status === 'converted' ? 'Converted — upgraded to a plan' : 'Signed up';
    const card = document.createElement('div');
    card.className = 'record-card';
    card.innerHTML =
      '<div style="flex:1;"><span class="cell-name">' + (inv.referredName || inv.referredEmail || 'A new trader') + '</span>' +
        '<div style="font-family:var(--font-mono); font-size:11.5px; color:var(--ink-3); margin-top:3px;">' + when + '</div></div>' +
      '<div style="text-align:right;">' +
        '<div style="font-family:var(--font-mono); font-size:13px; color:#f5c542; font-weight:700;">+' + (inv.pointsAwarded || 0) + ' pts</div>' +
        '<div style="font-family:var(--font-mono); font-size:11px; color:' + statusColor + '; margin-top:3px;">' + statusLabel + '</div>' +
      '</div>';
    wrap.appendChild(card);
  });
}

function renderLeaderboard(list, myUid){
  const wrap = document.getElementById('referral-leaderboard');
  if (!list.length) {
    wrap.innerHTML = '<p style="color:var(--ink-3); font-size:13.5px;">No one has earned invite points yet — be the first.</p>';
    return;
  }
  wrap.innerHTML = '';
  list.forEach((entry, i) => {
    const isMe = entry.uid === myUid;
    const roleTag = (typeof roleTagHtml === 'function') ? roleTagHtml(entry.plan, { size: 'small' }) : '';
    const avatarHtml = (typeof avatarImgHtml === 'function') ? avatarImgHtml(entry.uid, entry.name, entry, 32) : '';
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

  // Show my rank even if I'm outside the fetched top list.
  const myIndex = list.findIndex((e) => e.uid === myUid);
  const rankEl = document.getElementById('referral-rank');
  if (rankEl) rankEl.textContent = myIndex >= 0 ? ('#' + (myIndex + 1)) : (list.length ? '#' + (list.length + 1) + '+' : '—');
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

    db.collection('students').doc(user.uid).get().then((doc) => {
      const points = doc.exists ? (doc.data().referralPoints || 0) : 0;
      document.getElementById('referral-total-points').textContent = points;
    });

    db.collection('referrals').where('referrerUid', '==', user.uid).get()
      .then((snap) => {
        const invites = [];
        snap.forEach((doc) => invites.push(doc.data()));
        invites.sort((a, b) => {
          const ta = a.createdAt && a.createdAt.toMillis ? a.createdAt.toMillis() : 0;
          const tb = b.createdAt && b.createdAt.toMillis ? b.createdAt.toMillis() : 0;
          return tb - ta;
        });
        document.getElementById('referral-total-invites').textContent = invites.length;
        renderInviteList(invites);
      })
      .catch((err) => {
        console.error('Stryker: failed to load invites', err);
        document.getElementById('referral-invite-list').innerHTML =
          '<p style="color:var(--ink-3); font-size:13.5px;">Could not load your invites right now — try refreshing.</p>';
      });

    Promise.all([loadReferralLeaderboard(10), (typeof loadPlansForRoles === 'function' ? loadPlansForRoles() : Promise.resolve())])
      .then(([list]) => renderLeaderboard(list, user.uid))
      .catch((err) => {
        document.getElementById('referral-leaderboard').innerHTML =
          '<p style="color:var(--ink-3); font-size:13.5px;">Could not load the leaderboard: ' + (err.message || err) + '</p>';
      });
  });

  document.getElementById('referral-copy-btn').addEventListener('click', copyReferralLink);
});
