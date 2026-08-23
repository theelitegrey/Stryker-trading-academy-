// Stryker Trading Academy — Live Sessions (live-sessions.html)
// Depends on: assets/auth.js, assets/progress.js (for `db`)
// Read-only for students. Sessions are created/edited from the admin
// dashboard, stored in the top-level `liveSessions` Firestore collection.

function formatSessionDate(dateStr, timeStr){
  try {
    const d = new Date(dateStr + 'T' + (timeStr || '00:00'));
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) +
      (timeStr ? ' · ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : '');
  } catch(e) {
    return dateStr;
  }
}

function renderSessionRow(session){
  const row = document.createElement('div');
  row.className = 'event-item';
  const d = new Date(session.date + 'T00:00');
  const day = isNaN(d.getDate()) ? '—' : d.getDate();
  const mon = isNaN(d.getMonth()) ? '' : d.toLocaleDateString(undefined, { month: 'short' }).toUpperCase();
  row.innerHTML =
    '<div class="event-date"><b>' + day + '</b>' + mon + '</div>' +
    '<div class="event-body"><h4>' + (session.title || 'Untitled session') + '</h4>' +
    '<span>' + (session.time || '') + (session.instrument ? ' · ' + session.instrument : '') + '</span>' +
    (session.description ? '<br><span style="font-size:12px;">' + session.description + '</span>' : '') +
    '</div>';
  return row;
}

function loadLiveSessions(){
  db.collection('liveSessions').orderBy('date', 'asc').get()
    .then((snap) => {
      const today = new Date().toISOString().slice(0, 10);
      const upcoming = [];
      const past = [];
      snap.forEach((doc) => {
        const data = doc.data();
        (data.date >= today ? upcoming : past).push(data);
      });

      const upcomingEl = document.getElementById('live-upcoming-list');
      const pastEl = document.getElementById('live-past-list');

      upcomingEl.innerHTML = '';
      if (!upcoming.length) {
        upcomingEl.innerHTML = '<p style="color:var(--ink-3); font-size:13.5px;">No upcoming sessions scheduled yet. Check back soon, or admins can add one from the admin dashboard.</p>';
      } else {
        upcoming.forEach((s) => upcomingEl.appendChild(renderSessionRow(s)));
      }

      pastEl.innerHTML = '';
      if (!past.length) {
        pastEl.innerHTML = '<p style="color:var(--ink-3); font-size:13.5px;">No past sessions yet.</p>';
      } else {
        past.slice().reverse().forEach((s) => pastEl.appendChild(renderSessionRow(s)));
      }
    })
    .catch((err) => {
      console.error('Stryker: failed to load live sessions', err);
      document.getElementById('live-upcoming-list').innerHTML =
        '<p style="color:var(--ink-3); font-size:13.5px;">Could not load sessions: ' + (err.message || err) + '</p>';
      document.getElementById('live-past-list').innerHTML = '';
    });
}

document.addEventListener('DOMContentLoaded', () => {
  if (!auth) return;
  let handled = false;
  auth.onAuthStateChanged((user) => {
    if (handled) return;
    if (!user) {
      setTimeout(() => { if (!handled) window.location.href = 'login.html'; }, 1500);
      return;
    }
    handled = true;
    loadLiveSessions();
  });
});
