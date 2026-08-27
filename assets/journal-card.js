// Stryker Trading Academy — Trade Journal: shareable P&L card
// Depends on: journal-calc.js, JOURNAL_* globals, PF_DATA (journal-propfirms).
//
// Renders a 1080x1350 branded card on a <canvas> — period P&L, key stats,
// optionally the month calendar heat grid and the trading accounts — and
// downloads it as a PNG. Everything is drawn locally; nothing is uploaded.

const JCARD_W = 1080, JCARD_H = 1350;

function jcardPeriodTrades(period){
  const all = (JOURNAL_TRADES || []).filter((t) => t.pnl !== null && t.pnl !== undefined && t.date);
  if (period === 'all') return all;
  const now = new Date();
  let from;
  if (period === 'today') {
    from = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  } else if (period === 'week') {
    const dow = (now.getDay() + 6) % 7;             // Monday start
    from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dow);
  } else {                                          // month
    from = new Date(now.getFullYear(), now.getMonth(), 1);
  }
  return all.filter((t) => new Date(t.date + 'T00:00:00') >= from);
}

const JCARD_PERIOD_LABELS = {
  today: 'TODAY', week: 'THIS WEEK', month: 'THIS MONTH', all: 'ALL TIME'
};

function jcardMoney(v, currency){
  const sym = { USD: '$', EUR: '€', GBP: '£', JPY: '¥' }[currency] || '$';
  const sign = v < 0 ? '-' : (v > 0 ? '+' : '');
  return sign + sym + Math.abs(v).toLocaleString('en-US', { maximumFractionDigits: 0 });
}

function jcardRender(){
  const canvas = document.getElementById('jcard-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const period = document.getElementById('jcard-period').value;
  const showCal = document.getElementById('jcard-cal').checked;
  const showAccts = document.getElementById('jcard-accts').checked;
  const currency = (JOURNAL_SETTINGS && JOURNAL_SETTINGS.currency) || 'USD';

  const trades = jcardPeriodTrades(period);
  const stats = journalAggregateStats(trades);
  const byDay = {};
  trades.forEach((t) => { byDay[t.date] = (byDay[t.date] || 0) + t.pnl; });
  const bestDay = Object.keys(byDay).length ? Math.max(...Object.values(byDay)) : 0;
  const up = stats.totalPnl >= 0;
  const accent = up ? '#03c988' : '#e5484d';

  // ---- ground
  ctx.fillStyle = '#0a0c0b';
  ctx.fillRect(0, 0, JCARD_W, JCARD_H);
  const glow = ctx.createRadialGradient(JCARD_W / 2, 400, 60, JCARD_W / 2, 400, 900);
  glow.addColorStop(0, up ? 'rgba(3,201,136,0.16)' : 'rgba(229,72,77,0.14)');
  glow.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, JCARD_W, JCARD_H);

  // faint grid
  ctx.strokeStyle = 'rgba(255,255,255,0.025)';
  ctx.lineWidth = 1;
  for (let x = 0; x <= JCARD_W; x += 72) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, JCARD_H); ctx.stroke(); }
  for (let y = 0; y <= JCARD_H; y += 72) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(JCARD_W, y); ctx.stroke(); }

  // frame
  ctx.strokeStyle = up ? 'rgba(3,201,136,0.35)' : 'rgba(229,72,77,0.35)';
  ctx.lineWidth = 2;
  ctx.strokeRect(36, 36, JCARD_W - 72, JCARD_H - 72);

  // ---- header
  ctx.textAlign = 'left';
  ctx.fillStyle = accent;
  ctx.font = '700 30px "JetBrains Mono", monospace';
  ctx.fillText('◆ STRYKER', 84, 130);
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.fillText(' TRADE JOURNAL', 84 + ctx.measureText('◆ STRYKER').width, 130);

  ctx.textAlign = 'right';
  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.font = '700 26px "JetBrains Mono", monospace';
  ctx.fillText(JCARD_PERIOD_LABELS[period], JCARD_W - 84, 130);

  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.beginPath(); ctx.moveTo(84, 170); ctx.lineTo(JCARD_W - 84, 170); ctx.stroke();

  // ---- hero P&L
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.font = '600 28px "JetBrains Mono", monospace';
  ctx.fillText('NET P&L', JCARD_W / 2, 280);

  ctx.fillStyle = accent;
  ctx.shadowColor = accent; ctx.shadowBlur = 40;
  ctx.font = '700 130px "JetBrains Mono", monospace';
  ctx.fillText(jcardMoney(stats.totalPnl, currency), JCARD_W / 2, 420);
  ctx.shadowBlur = 0;

  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  ctx.font = '400 26px "JetBrains Mono", monospace';
  const dateStr = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  ctx.fillText(dateStr, JCARD_W / 2, 475);

  // ---- stat tiles
  const tiles = [
    ['TRADES', String(stats.closedTrades)],
    ['WIN RATE', stats.closedTrades ? Math.round(stats.winRate) + '%' : '—'],
    ['PROFIT FACTOR', stats.closedTrades ? (isFinite(stats.profitFactor) ? stats.profitFactor.toFixed(2) : '∞') : '—'],
    ['BEST DAY', stats.closedTrades ? jcardMoney(bestDay, currency) : '—']
  ];
  const tw = (JCARD_W - 168 - 3 * 20) / 4;
  tiles.forEach((tile, i) => {
    const x = 84 + i * (tw + 20);
    ctx.fillStyle = 'rgba(255,255,255,0.035)';
    ctx.strokeStyle = 'rgba(255,255,255,0.09)';
    ctx.beginPath();
    ctx.roundRect(x, 530, tw, 118, 14);
    ctx.fill(); ctx.stroke();
    ctx.textAlign = 'center';
    ctx.fillStyle = '#eeeeee';
    ctx.font = '700 38px "JetBrains Mono", monospace';
    ctx.fillText(tile[1], x + tw / 2, 590);
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.font = '600 17px "JetBrains Mono", monospace';
    ctx.fillText(tile[0], x + tw / 2, 626);
  });

  let y = 700;

  // ---- calendar block
  if (showCal) {
    y = jcardDrawCalendar(ctx, y, currency);
  }

  // ---- accounts block
  if (showAccts) {
    y = jcardDrawAccounts(ctx, y, currency);
  }

  // ---- footer
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(255,255,255,0.3)';
  ctx.font = '600 24px "JetBrains Mono", monospace';
  ctx.fillText('strykertrading.com', JCARD_W / 2, JCARD_H - 78);
}

function jcardDrawCalendar(ctx, top, currency){
  const now = new Date();
  const year = now.getFullYear(), month = now.getMonth();
  const byDay = {};
  (JOURNAL_TRADES || []).forEach((t) => {
    if (!t.date || t.pnl === null || t.pnl === undefined) return;
    byDay[t.date] = (byDay[t.date] || 0) + t.pnl;
  });

  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.font = '600 24px "JetBrains Mono", monospace';
  ctx.fillText(now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }).toUpperCase(), 84, top + 10);

  const cols = 7, cell = 118, gap = 12;
  const gridW = cols * cell + (cols - 1) * gap;
  const startX = (JCARD_W - gridW) / 2;
  let gy = top + 40;

  const firstDow = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const weeks = Math.ceil((firstDow + daysInMonth) / 7);
  const cellH = Math.min(cell, Math.floor((330) / weeks));

  for (let day = 1; day <= daysInMonth; day++) {
    const idx = firstDow + day - 1;
    const cx = startX + (idx % 7) * (cell + gap);
    const cy = gy + Math.floor(idx / 7) * (cellH + gap);
    const dateStr = year + '-' + String(month + 1).padStart(2, '0') + '-' + String(day).padStart(2, '0');
    const pnl = byDay[dateStr];

    ctx.beginPath();
    ctx.roundRect(cx, cy, cell, cellH, 10);
    if (pnl === undefined) {
      ctx.fillStyle = 'rgba(255,255,255,0.03)';
      ctx.fill();
    } else {
      ctx.fillStyle = pnl >= 0 ? 'rgba(3,201,136,0.22)' : 'rgba(229,72,77,0.2)';
      ctx.fill();
      ctx.strokeStyle = pnl >= 0 ? 'rgba(3,201,136,0.6)' : 'rgba(229,72,77,0.6)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.font = '600 15px "JetBrains Mono", monospace';
    ctx.fillText(String(day), cx + 10, cy + 24);
    if (pnl !== undefined) {
      ctx.textAlign = 'center';
      ctx.fillStyle = pnl >= 0 ? '#03c988' : '#e5484d';
      ctx.font = '700 20px "JetBrains Mono", monospace';
      const short = (pnl < 0 ? '-' : '') + (Math.abs(pnl) >= 1000 ? (Math.abs(pnl) / 1000).toFixed(1) + 'k' : Math.round(Math.abs(pnl)));
      ctx.fillText(short, cx + cell / 2, cy + cellH - 14);
    }
  }
  return gy + weeks * (cellH + gap) + 30;
}

function jcardDrawAccounts(ctx, top, currency){
  const firms = (typeof PF_DATA !== 'undefined' && PF_DATA.firms) ? PF_DATA.firms : [];
  const rows = [];
  // per-account trading P&L from the journal
  const acctPnl = {};
  (JOURNAL_TRADES || []).forEach((t) => {
    if (typeof t.pnl !== 'number') return;
    const a = t.account || 'Personal';
    acctPnl[a] = (acctPnl[a] || 0) + t.pnl;
  });
  firms.slice(0, 3).forEach((f) => {
    const spent = (f.expenses || []).reduce((s, e) => s + (parseFloat(e.amount) || 0), 0);
    const received = (f.payouts || []).reduce((s, p) => s + (parseFloat(p.amount) || 0), 0);
    rows.push({ name: f.name, status: f.status, net: received - spent + (acctPnl[f.name] || 0) });
  });
  if (acctPnl['Personal']) rows.push({ name: 'Personal', status: null, net: acctPnl['Personal'] });
  if (!rows.length) return top;

  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.font = '600 24px "JetBrains Mono", monospace';
  ctx.fillText('ACCOUNTS', 84, top + 10);

  let y = top + 40;
  rows.slice(0, 4).forEach((r) => {
    ctx.fillStyle = 'rgba(255,255,255,0.035)';
    ctx.strokeStyle = 'rgba(255,255,255,0.09)';
    ctx.beginPath();
    ctx.roundRect(84, y, JCARD_W - 168, 62, 12);
    ctx.fill(); ctx.stroke();
    ctx.textAlign = 'left';
    ctx.fillStyle = '#eeeeee';
    ctx.font = '700 24px "JetBrains Mono", monospace';
    ctx.fillText(r.name.slice(0, 24), 108, y + 40);
    if (r.status) {
      ctx.fillStyle = r.status === 'funded' ? '#03c988' : (r.status === 'failed' ? '#e5484d' : '#f5c542');
      ctx.font = '700 16px "JetBrains Mono", monospace';
      ctx.fillText(r.status.toUpperCase(), 108 + ctx.measureText(r.name.slice(0, 24)).width + 40, y + 40);
    }
    ctx.textAlign = 'right';
    ctx.fillStyle = r.net > 0 ? '#03c988' : (r.net < 0 ? '#e5484d' : '#eeeeee');
    ctx.font = '700 26px "JetBrains Mono", monospace';
    ctx.fillText(jcardMoney(r.net, currency), JCARD_W - 108, y + 41);
    y += 74;
  });
  return y + 20;
}

function jcardDownload(){
  const canvas = document.getElementById('jcard-canvas');
  if (!canvas) return;
  canvas.toBlob((blob) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'stryker-pnl-' + document.getElementById('jcard-period').value + '.png';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }, 'image/png');
}

function jcardOpen(){
  const modal = document.getElementById('jcard-modal');
  if (!modal) return;
  modal.style.display = 'flex';
  // Fonts must be loaded before the canvas draws, or every label renders in
  // the browser's fallback face on first open.
  const draw = () => jcardRender();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(draw);
  else draw();
}

document.addEventListener('DOMContentLoaded', () => {
  const openBtn = document.getElementById('jcard-open');
  if (!openBtn) return;
  openBtn.addEventListener('click', jcardOpen);
  document.getElementById('jcard-close').addEventListener('click', () => {
    document.getElementById('jcard-modal').style.display = 'none';
  });
  document.getElementById('jcard-modal').addEventListener('click', (e) => {
    if (e.target.id === 'jcard-modal') e.currentTarget.style.display = 'none';
  });
  document.getElementById('jcard-download').addEventListener('click', jcardDownload);
  ['jcard-period', 'jcard-cal', 'jcard-accts'].forEach((id) => {
    document.getElementById(id).addEventListener('change', jcardRender);
  });
});
