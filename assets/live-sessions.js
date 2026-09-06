// Stryker Trading Academy — Live Sessions (live-sessions.html)
// Depends on: assets/auth.js, assets/progress.js (for `db`)
//
// Sessions are created from the admin dashboard into the `liveSessions`
// collection; a session with a videoId can be flipped to isLive there, which
// is what puts the player + chat at the top of this page (via a realtime
// listener, so students already on the page see it appear without a refresh).
//
// PLAYER: YouTube IFrame API, but the iframe itself is inert — a transparent
// shield sits over it (and the iframe gets pointer-events:none), so nothing
// on the embed is clickable: no title link, no share, no watch-on-YouTube.
// All interaction goes through our own control bar (play/pause, ±10s, live
// edge, volume, fullscreen, and a seek bar for replays). This deters casual
// link-sharing; it is not DRM, and the page never pretends otherwise.
//
// CHAT: liveSessions/{id}/chat subcollection (rules: students read + create
// their own messages, admins moderate). Live sessions only — replays show
// the player without the chat column.
//
// PLAN GATE (the live/replay split): replays are a Pro feature, the live
// room — realtime player + chat — is Elite's. Gated by plan RANK, not name,
// so renaming a tier in Billing & plans doesn't break it: rank 1+ unlocks
// replays, rank 2+ unlocks live. Admins bypass. A student below the bar
// still SEES that a session is live — a locked card with an upgrade button
// converts better than an empty page — they just can't open the player.
// Unresolvable plan data fails open, like every other gate on the site.

let LS_SESSIONS = [];
let LS_PLAYER = null;
let LS_PLAYER_MODE = null;      // 'live' | 'replay'
let LS_ACTIVE_VIDEO = null;
let LS_CHAT_UNSUB = null;
let LS_LIVE_UNSUB = null;
let LS_COUNTDOWN_TIMER = null;
let LS_PROGRESS_TIMER = null;
let LS_UID = null;
let LS_NAME = 'Trader';

const LS_REPLAY_MIN_RANK = 1;   // Pro and up
const LS_LIVE_MIN_RANK = 2;     // Elite and up
let LS_ACCESS = { live: true, replay: true };

function lsCanWatch(mode){
  return mode === 'live' ? LS_ACCESS.live : LS_ACCESS.replay;
}

// The name of the cheapest plan whose rank clears the bar — so the upsell
// says "Go Elite" / "Upgrade to Pro" with the real, current plan names.
function lsPlanNameForRank(minRank){
  const plans = (typeof getCachedPlansForRoles === 'function') ? getCachedPlansForRoles() : [];
  const match = plans.find((p) => (p.rank ?? 0) >= minRank); // list is rank-ascending
  return match ? match.name : null;
}

function lsPromptUpgrade(mode){
  const planName = lsPlanNameForRank(mode === 'live' ? LS_LIVE_MIN_RANK : LS_REPLAY_MIN_RANK);
  const reason = mode === 'live'
    ? ((planName ? planName + ' members' : 'Higher plans') + ' trade the live sessions in real time, chat included.')
    : ('Session replays are included from the ' + (planName || 'next') + ' plan up.');
  if (typeof openPlanUpgradeModal === 'function') openPlanUpgradeModal(reason);
}

function formatSessionDate(dateStr, timeStr){
  try {
    const d = new Date(dateStr + 'T' + (timeStr || '00:00'));
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) +
      (timeStr ? ' · ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : '');
  } catch(e) {
    return dateStr;
  }
}

function lsEsc(s){
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ---- YouTube player (locked-down) -------------------------------------------

let LS_YT_READY = null;
function lsLoadYouTubeApi(){
  if (LS_YT_READY) return LS_YT_READY;
  LS_YT_READY = new Promise((resolve) => {
    if (window.YT && window.YT.Player) { resolve(); return; }
    window.onYouTubeIframeAPIReady = () => resolve();
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    document.head.appendChild(s);
  });
  return LS_YT_READY;
}

function lsOpenPlayer(session, mode){
  if (!lsCanWatch(mode)) { lsPromptUpgrade(mode); return; }
  const hero = document.getElementById('live-hero');
  hero.style.display = '';
  document.getElementById('live-hero-title').textContent = session.title || 'Live session';
  document.getElementById('live-hero-sub').textContent =
    (session.instrument ? session.instrument + ' · ' : '') + formatSessionDate(session.date, session.time) +
    (mode === 'replay' ? ' · replay' : '');
  document.getElementById('live-hero-badge').style.display = mode === 'live' ? '' : 'none';
  document.getElementById('lc-live').style.display = mode === 'live' ? '' : 'none';
  document.getElementById('lc-progress').style.display = mode === 'live' ? 'none' : '';
  LS_PLAYER_MODE = mode;

  // On-player title flash: shows over the video for a few seconds whenever a
  // session opens, then fades, leaving only the corner watermark.
  const tbar = document.getElementById('live-player-titlebar');
  if (tbar) {
    document.getElementById('lpt-title').textContent = session.title || '';
    document.getElementById('lpt-live').style.display = mode === 'live' ? '' : 'none';
    tbar.classList.add('show');
    clearTimeout(tbar._hideTimer);
    tbar._hideTimer = setTimeout(() => tbar.classList.remove('show'), 4000);
  }

  if (mode === 'live') lsOpenChat(session);
  else lsCloseChat();

  hero.scrollIntoView({ behavior: 'smooth', block: 'start' });

  if (LS_ACTIVE_VIDEO === session.videoId && LS_PLAYER) return;
  LS_ACTIVE_VIDEO = session.videoId;

  lsLoadYouTubeApi().then(() => {
    if (LS_PLAYER) {
      LS_PLAYER.loadVideoById(session.videoId);
      return;
    }
    LS_PLAYER = new YT.Player('live-player-host', {
      width: '100%',
      height: '100%',
      videoId: session.videoId,
      playerVars: {
        controls: 0, rel: 0, fs: 0, disablekb: 1, iv_load_policy: 3,
        modestbranding: 1, playsinline: 1
      },
      events: {
        onReady: (e) => { try { e.target.setVolume(80); } catch (err) {} },
        onStateChange: (e) => {
          const btn = document.getElementById('lc-play');
          if (btn) btn.textContent = e.data === YT.PlayerState.PLAYING ? '❚❚' : '▶';
        }
      }
    });
  });
}

function lsWireControls(){
  const p = () => LS_PLAYER;
  const wrap = document.getElementById('live-player-wrap');
  if (!wrap) return;

  // Nothing on the embed itself is interactive.
  wrap.addEventListener('contextmenu', (e) => e.preventDefault());

  document.getElementById('lc-play').addEventListener('click', () => {
    if (!p()) return;
    const state = p().getPlayerState();
    if (state === YT.PlayerState.PLAYING) p().pauseVideo(); else p().playVideo();
  });
  document.getElementById('lc-back').addEventListener('click', () => {
    if (p()) p().seekTo(Math.max(0, p().getCurrentTime() - 10), true);
  });
  document.getElementById('lc-fwd').addEventListener('click', () => {
    if (p()) p().seekTo(p().getCurrentTime() + 10, true);
  });
  document.getElementById('lc-live').addEventListener('click', () => {
    if (p()) { p().seekTo(p().getDuration(), true); p().playVideo(); }
  });
  document.getElementById('lc-mute').addEventListener('click', () => {
    if (!p()) return;
    if (p().isMuted()) { p().unMute(); document.getElementById('lc-mute').textContent = '🔊'; }
    else { p().mute(); document.getElementById('lc-mute').textContent = '🔇'; }
  });
  document.getElementById('lc-vol').addEventListener('input', (e) => {
    if (p()) { p().setVolume(parseInt(e.target.value, 10)); p().unMute(); document.getElementById('lc-mute').textContent = '🔊'; }
  });
  document.getElementById('lc-fs').addEventListener('click', () => {
    // Fullscreen the WRAPPER, not the iframe, so the shield and our controls
    // stay in charge even in fullscreen.
    const panel = document.querySelector('.live-player-panel');
    if (document.fullscreenElement) document.exitFullscreen();
    else if (panel && panel.requestFullscreen) panel.requestFullscreen();
  });

  // Replay seek bar
  const bar = document.getElementById('lc-progress');
  bar.addEventListener('click', (e) => {
    if (!p() || LS_PLAYER_MODE !== 'replay') return;
    const r = bar.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    p().seekTo(frac * p().getDuration(), true);
  });
  LS_PROGRESS_TIMER = setInterval(() => {
    if (!p() || LS_PLAYER_MODE !== 'replay') return;
    try {
      const d = p().getDuration();
      const fill = document.getElementById('lc-progress-fill');
      if (d && fill) fill.style.width = ((p().getCurrentTime() / d) * 100) + '%';
    } catch (e) {}
  }, 1000);
}

// ---- chat -------------------------------------------------------------------

function lsOpenChat(session){
  const panel = document.getElementById('live-chat-panel');
  panel.style.display = '';
  if (LS_CHAT_UNSUB) LS_CHAT_UNSUB();
  const msgsEl = document.getElementById('live-chat-msgs');
  msgsEl.innerHTML = '<p style="color:var(--ink-3); font-size:12.5px;">Loading chat…</p>';

  LS_CHAT_UNSUB = db.collection('liveSessions').doc(session.id).collection('chat')
    .orderBy('ts').limitToLast(200)
    .onSnapshot((snap) => {
      const atBottom = msgsEl.scrollHeight - msgsEl.scrollTop - msgsEl.clientHeight < 60;
      const rows = [];
      snap.forEach((doc) => {
        const m = doc.data();
        rows.push('<div class="lcm' + (m.uid === LS_UID ? ' me' : '') + '">' +
          '<b>' + lsEsc(m.name || 'Trader') + '</b>' +
          '<span>' + lsEsc(m.text || '') + '</span></div>');
      });
      msgsEl.innerHTML = rows.length ? rows.join('') :
        '<p style="color:var(--ink-3); font-size:12.5px;">No messages yet — say hi 👋</p>';
      document.getElementById('live-chat-count').textContent = snap.size ? (snap.size + (snap.size === 200 ? '+' : '') + ' messages') : '';
      if (atBottom) msgsEl.scrollTop = msgsEl.scrollHeight;
    }, (err) => {
      msgsEl.innerHTML = '<p style="color:var(--ink-3); font-size:12.5px;">Chat unavailable: ' + lsEsc(err.message || err) + '</p>';
    });

  const send = () => {
    const input = document.getElementById('live-chat-text');
    const text = input.value.trim().slice(0, 500);
    if (!text || !LS_UID) return;
    const btn = document.getElementById('live-chat-send');
    btn.disabled = true;
    db.collection('liveSessions').doc(session.id).collection('chat').add({
      uid: LS_UID, name: LS_NAME, text,
      ts: firebase.firestore.FieldValue.serverTimestamp()
    }).then(() => { input.value = ''; })
      .catch((err) => showToast('error', 'Could not send: ' + (err.message || err)))
      .finally(() => { setTimeout(() => { btn.disabled = false; }, 400); });
  };
  document.getElementById('live-chat-send').onclick = send;
  document.getElementById('live-chat-text').onkeydown = (e) => { if (e.key === 'Enter') send(); };
}

function lsCloseChat(){
  if (LS_CHAT_UNSUB) { LS_CHAT_UNSUB(); LS_CHAT_UNSUB = null; }
  const panel = document.getElementById('live-chat-panel');
  if (panel) panel.style.display = 'none';
}

// ---- live upsell (plan below the live bar while a session runs) -------------

function lsShowLiveUpsell(session){
  let panel = document.getElementById('live-upsell-panel');
  const planName = lsPlanNameForRank(LS_LIVE_MIN_RANK);
  if (!panel) {
    if (!document.getElementById('ls-upsell-style')) {
      const st = document.createElement('style');
      st.id = 'ls-upsell-style';
      st.textContent = '@keyframes ls-upsell-pulse{0%,100%{opacity:1;box-shadow:0 0 0 0 rgba(229,72,77,.5);}50%{opacity:.55;box-shadow:0 0 0 7px rgba(229,72,77,0);}}';
      document.head.appendChild(st);
    }
    panel = document.createElement('div');
    panel.id = 'live-upsell-panel';
    panel.className = 'panel';
    panel.style.cssText = 'margin-bottom:22px; border-color:rgba(229,72,77,.45); background:linear-gradient(135deg, rgba(229,72,77,.08), transparent 55%);';
    const hero = document.getElementById('live-hero');
    if (hero && hero.parentNode) hero.parentNode.insertBefore(panel, hero);
    else document.querySelector('.dash-main').prepend(panel);
  }
  panel.innerHTML =
    '<div style="display:flex; align-items:center; gap:16px; flex-wrap:wrap;">' +
      '<span style="display:flex; align-items:center; gap:8px; font-family:var(--font-mono); font-size:12px; font-weight:800; letter-spacing:.12em; color:#ff6d76;">' +
        '<i style="width:9px; height:9px; border-radius:50%; background:#e5484d; animation:ls-upsell-pulse 1.4s ease-in-out infinite; display:inline-block;"></i>LIVE NOW</span>' +
      '<div style="flex:1 1 240px;">' +
        '<h3 style="font-size:16px; color:var(--ink-0); margin:0 0 3px;">' + lsEsc(session.title || 'Live trading session') + '</h3>' +
        '<span style="font-size:12.5px; color:var(--ink-3);">' +
          (session.instrument ? lsEsc(session.instrument) + ' · ' : '') +
          'happening right now — ' + (planName ? lsEsc(planName) + ' members are' : 'higher plans are') + ' in the room.</span>' +
      '</div>' +
      '<button type="button" class="btn btn-primary" data-open-plan-modal ' +
        'data-upgrade-reason="' + lsEsc((planName ? planName + ' members' : 'Higher plans') + ' trade the live sessions in real time, chat included.') + '">' +
        (planName ? 'Go ' + lsEsc(planName) + ' to join live' : 'Upgrade to join live') + '</button>' +
    '</div>';
  panel.style.display = '';
}

function lsHideLiveUpsell(){
  const panel = document.getElementById('live-upsell-panel');
  if (panel) panel.style.display = 'none';
}

// ---- next-session countdown -------------------------------------------------

function lsRenderNext(next){
  const panel = document.getElementById('live-next-panel');
  const body = document.getElementById('live-next-body');
  if (LS_COUNTDOWN_TIMER) clearInterval(LS_COUNTDOWN_TIMER);
  if (!next) { panel.style.display = 'none'; return; }
  panel.style.display = '';

  const target = new Date(next.date + 'T' + (next.time || '00:00'));
  const tick = () => {
    const ms = target - Date.now();
    let counter;
    if (isNaN(ms)) counter = '';
    else if (ms <= 0) counter = 'starting any moment — hold tight';
    else {
      const d = Math.floor(ms / 86400000), h = Math.floor(ms / 3600000) % 24,
            m = Math.floor(ms / 60000) % 60, s = Math.floor(ms / 1000) % 60;
      counter = (d ? d + 'd ' : '') + String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
    }
    body.innerHTML =
      '<div class="live-next-inner">' +
        '<div>' +
          '<h3>' + lsEsc(next.title || 'Untitled session') + '</h3>' +
          '<span>' + formatSessionDate(next.date, next.time) + (next.instrument ? ' · ' + lsEsc(next.instrument) : '') + '</span>' +
        '</div>' +
        '<div class="live-countdown">' + counter + '</div>' +
      '</div>';
  };
  tick();
  LS_COUNTDOWN_TIMER = setInterval(tick, 1000);
}

// ---- session lists ----------------------------------------------------------

// Session recap chips (filled in by the admin after a session): trades taken,
// win/loss split, risk:reward.
function lsStatsHtml(s){
  const chips = [];
  if (s.tradesTotal !== null && s.tradesTotal !== undefined) chips.push(s.tradesTotal + ' trade' + (s.tradesTotal === 1 ? '' : 's'));
  if ((s.tradesWon !== null && s.tradesWon !== undefined) || (s.tradesLost !== null && s.tradesLost !== undefined)) {
    chips.push('<b class="gm-up">' + (s.tradesWon ?? 0) + 'W</b> / <b class="gm-down">' + (s.tradesLost ?? 0) + 'L</b>');
  }
  if (s.riskReward) chips.push('RR ' + lsEsc(s.riskReward));
  if (!chips.length) return '';
  return '<br><span class="ls-stats">' + chips.join('<i></i>') + '</span>';
}

function renderSessionRow(session, isPast){
  const row = document.createElement('div');
  row.className = 'event-item';
  const d = new Date(session.date + 'T00:00');
  const day = isNaN(d.getDate()) ? '—' : d.getDate();
  const mon = isNaN(d.getMonth()) ? '' : d.toLocaleDateString(undefined, { month: 'short' }).toUpperCase();
  row.innerHTML =
    '<div class="event-date"><b>' + day + '</b>' + mon + '</div>' +
    '<div class="event-body"><h4>' + lsEsc(session.title || 'Untitled session') + '</h4>' +
    '<span>' + lsEsc(session.time || '') + (session.instrument ? ' · ' + lsEsc(session.instrument) : '') + '</span>' +
    (session.description ? '<br><span style="font-size:12px;">' + lsEsc(session.description) + '</span>' : '') +
    (isPast ? lsStatsHtml(session) : '') +
    '</div>' +
    (isPast && session.videoId
      ? (LS_ACCESS.replay
          ? '<button class="btn btn-ghost btn-sm" style="align-self:center;">▶ Watch replay</button>'
          : '<button class="btn btn-ghost btn-sm" style="align-self:center; opacity:.75;">🔒 Replay — upgrade</button>')
      : '');
  const btn = row.querySelector('button');
  if (btn) btn.addEventListener('click', () => lsOpenPlayer(session, 'replay'));
  return row;
}

function lsRenderLists(){
  const today = new Date().toISOString().slice(0, 10);
  const upcoming = LS_SESSIONS.filter((s) => s.date >= today).sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || '')));
  const past = LS_SESSIONS.filter((s) => s.date < today).sort((a, b) => (b.date + (b.time || '')).localeCompare(a.date + (a.time || '')));

  const upcomingEl = document.getElementById('live-upcoming-list');
  const pastEl = document.getElementById('live-past-list');

  upcomingEl.innerHTML = '';
  if (!upcoming.length) {
    upcomingEl.innerHTML = '<p style="color:var(--ink-3); font-size:13.5px;">No upcoming sessions scheduled yet. Check back soon.</p>';
  } else {
    upcoming.forEach((s) => upcomingEl.appendChild(renderSessionRow(s, false)));
  }

  pastEl.innerHTML = '';
  if (!past.length) {
    pastEl.innerHTML = '<p style="color:var(--ink-3); font-size:13.5px;">No past sessions yet.</p>';
  } else {
    past.forEach((s) => pastEl.appendChild(renderSessionRow(s, true)));
  }

  const live = LS_SESSIONS.find((s) => s.isLive && s.videoId);
  if (live && !LS_ACCESS.live) {
    // A session is live but this plan can't enter the room: show it, locked.
    lsShowLiveUpsell(live);
    lsRenderNext(null);
  } else if (live) {
    lsHideLiveUpsell();
    lsOpenPlayer(live, 'live');
    lsRenderNext(null);
  } else {
    lsHideLiveUpsell();
    // Live just ended (or never started): drop back to the countdown. The
    // player stays open only if the student explicitly opened a replay.
    if (LS_PLAYER_MODE === 'live') {
      document.getElementById('live-hero').style.display = 'none';
      lsCloseChat();
      if (LS_PLAYER) { try { LS_PLAYER.stopVideo(); } catch (e) {} }
      LS_PLAYER_MODE = null; LS_ACTIVE_VIDEO = null;
    }
    lsRenderNext(upcoming[0] || null);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  if (!auth) return;
  lsWireControls();
  let handled = false;
  auth.onAuthStateChanged((user) => {
    if (handled) return;
    if (!user) {
      setTimeout(() => { if (!handled) goToLoginPreservingReturn(); }, 1500);
      return;
    }
    handled = true;
    LS_UID = user.uid;
    LS_NAME = user.displayName || (user.email ? user.email.split('@')[0] : 'Trader');

    // Resolve the plan gate BEFORE the first render, so a locked student
    // never sees the player flash open and then vanish. Same parallel reads
    // plan-guard.js makes; the results are answered from cache by the SDK.
    const adminCheck = db.collection('admins').doc(user.uid).get().catch(() => null);
    const studentCheck = db.collection('students').doc(user.uid).get().catch(() => null);
    const rolesCheck = (typeof loadPlansForRoles === 'function') ? loadPlansForRoles() : Promise.resolve();
    Promise.all([adminCheck, studentCheck, rolesCheck]).then(([adminDoc, studentDoc]) => {
      if (adminDoc && adminDoc.exists) return; // admins keep full access
      const plan = (studentDoc && studentDoc.exists) ? studentDoc.data().plan : null;
      // An unknown or missing plan is a data problem, not a permission one —
      // fail open, same as roles.js does for chapters.
      if (!plan || typeof rankOf !== 'function' || typeof findPlan !== 'function' || !findPlan(plan)) return;
      const rank = rankOf(plan);
      LS_ACCESS = { live: rank >= LS_LIVE_MIN_RANK, replay: rank >= LS_REPLAY_MIN_RANK };
    }).catch(() => {}).then(() => lsSubscribe());
  });

  function lsSubscribe(){
    // Realtime: going live in the admin flips this page for everyone on it.
    LS_LIVE_UNSUB = db.collection('liveSessions').orderBy('date', 'asc')
      .onSnapshot((snap) => {
        LS_SESSIONS = [];
        snap.forEach((doc) => LS_SESSIONS.push(Object.assign({ id: doc.id }, doc.data())));
        lsRenderLists();
      }, (err) => {
        console.error('Stryker: failed to load live sessions', err);
        document.getElementById('live-upcoming-list').innerHTML =
          '<p style="color:var(--ink-3); font-size:13.5px;">Could not load sessions: ' + (err.message || err) + '</p>';
        document.getElementById('live-past-list').innerHTML = '';
      });
  }
});
