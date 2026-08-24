// Stryker Trading Academy — ICT-style killzone session tracker (market-news.html)
// Pure client-side, no backend needed. Times are the commonly-referenced ICT
// killzone windows in US Eastern Time (America/New_York), which
// automatically accounts for daylight saving via Intl's timeZone handling.
//
// Honest note: these are widely-cited reference windows from ICT-style
// trading education, not an official exchange-defined standard — different
// educators sometimes draw the boundaries a few minutes differently.

const KILLZONES = [
  { name: 'Asian Killzone', startHour: 20, startMin: 0, endHour: 24, endMin: 0 },   // 8:00 PM–12:00 AM ET
  { name: 'London Killzone', startHour: 2, startMin: 0, endHour: 5, endMin: 0 },    // 2:00–5:00 AM ET
  { name: 'New York Killzone', startHour: 7, startMin: 0, endHour: 10, endMin: 0 }  // 7:00–10:00 AM ET
];

function getNyParts(){
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour12: false,
    hour: 'numeric', minute: 'numeric'
  });
  const parts = fmt.formatToParts(new Date());
  const map = {};
  parts.forEach(p => { map[p.type] = p.value; });
  return map;
}

function minutesSinceMidnight(hour, min){ return hour * 60 + min; }

function formatHour(h, m){
  const period = h >= 12 ? 'PM' : 'AM';
  let displayHour = h % 12;
  if (displayHour === 0) displayHour = 12;
  return displayHour + (m ? ':' + String(m).padStart(2, '0') : '') + ' ' + period;
}

function renderKillzones(){
  const container = document.getElementById('killzone-widget');
  if (!container) return;

  const nyParts = getNyParts();
  const hour = parseInt(nyParts.hour, 10) % 24;
  const minute = parseInt(nyParts.minute, 10);
  const nowMinutes = minutesSinceMidnight(hour, minute);

  const timeLabel = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit', hour12: true
  }).format(new Date());

  let html = '<div class="killzone-clock"><span class="killzone-clock-time">' + timeLabel + '</span><span class="killzone-clock-label">New York time (ET) — the reference zone ICT killzones are built around</span></div>';
  html += '<div class="killzone-rows">';

  KILLZONES.forEach((kz) => {
    const start = minutesSinceMidnight(kz.startHour, kz.startMin);
    const end = minutesSinceMidnight(kz.endHour, kz.endMin);
    const isActive = nowMinutes >= start && nowMinutes < end;
    const rangeLabel = formatHour(kz.startHour, kz.startMin) + ' – ' + formatHour(kz.endHour === 24 ? 0 : kz.endHour, kz.endMin) + (kz.endHour === 24 ? ' (midnight)' : '');

    html +=
      '<div class="killzone-row' + (isActive ? ' active' : '') + '">' +
        '<div class="killzone-dot"></div>' +
        '<div class="killzone-info"><span class="killzone-name">' + kz.name + '</span><span class="killzone-range">' + rangeLabel + ' ET</span></div>' +
        '<span class="killzone-status">' + (isActive ? 'Active now' : 'Closed') + '</span>' +
      '</div>';
  });

  html += '</div>';
  container.innerHTML = html;
}

document.addEventListener('DOMContentLoaded', () => {
  if (!document.getElementById('killzone-widget')) return;
  renderKillzones();
  setInterval(renderKillzones, 30000);
});
