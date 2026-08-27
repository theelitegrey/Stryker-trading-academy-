// Stryker Trading Academy — Trade Journal: shareable P&L card
// Depends on: journal-calc.js, JOURNAL_* globals, PF_DATA (journal-propfirms).
//
// Renders a branded 1080px-wide card on a <canvas> — period P&L, a
// configurable set of stat tiles, optionally the month calendar heat grid
// and the trading accounts — and downloads it as a PNG. The card's height
// grows and shrinks with what's selected, so a minimal card stays compact.
// Everything is drawn locally; nothing is uploaded.

const JCARD_W = 1080;

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

// Every stat the card can carry. Each entry: [key, label, valueFn(stats, extras)].
const JCARD_STAT_DEFS = [
  ['trades',    'TRADES',        (s) => String(s.closedTrades)],
  ['winrate',   'WIN RATE',      (s) => s.closedTrades ? Math.round(s.winRate) + '%' : '—'],
  ['pf',        'PROFIT FACTOR', (s) => s.closedTrades ? (isFinite(s.profitFactor) ? s.profitFactor.toFixed(2) : '∞') : '—'],
  ['bestday',   'BEST DAY',      (s, x) => s.closedTrades ? jcardMoney(x.bestDay, x.currency) : '—'],
  ['besttrade', 'BEST TRADE',    (s, x) => s.closedTrades ? jcardMoney(x.bestTrade, x.currency) : '—'],
  ['avgwin',    'AVG WIN',       (s, x) => s.winCount ? jcardMoney(s.avgWin, x.currency) : '—'],
  ['avgloss',   'AVG LOSS',      (s, x) => s.lossCount ? jcardMoney(-s.avgLoss, x.currency) : '—'],
  ['wl',        'WINS / LOSSES', (s) => s.closedTrades ? s.winCount + 'W · ' + s.lossCount + 'L' : '—']
];

// Which stats are on the card. Everything on by default; persists per device.
let JCARD_OPTS = {};
JCARD_STAT_DEFS.forEach(([k]) => { JCARD_OPTS[k] = true; });
try {
  const saved = JSON.parse(localStorage.getItem('stryker_jcard_opts') || 'null');
  if (saved) JCARD_OPTS = Object.assign(JCARD_OPTS, saved);
} catch (e) {}

let JCARD_NAME = '';
try { JCARD_NAME = localStorage.getItem('stryker_jcard_name') || ''; } catch (e) {}

function jcardMoney(v, currency){
  const sym = { USD: '$', EUR: '€', GBP: '£', JPY: '¥' }[currency] || '$';
  const sign = v < 0 ? '-' : (v > 0 ? '+' : '');
  return sign + sym + Math.abs(v).toLocaleString('en-US', { maximumFractionDigits: 0 });
}

// The stat-selection chip row, including a Select all / none master chip.
function jcardRenderStatChips(){
  const host = document.getElementById('jcard-stats');
  if (!host) return;
  const allOn = JCARD_STAT_DEFS.every(([k]) => JCARD_OPTS[k]);
  host.innerHTML =
    '<button type="button" class="term-cat' + (allOn ? ' is-on' : '') + '" data-stat="__all">' +
      '<i style="background:' + (allOn ? '#f5c542' : '#5c6472') + '"></i>All</button>' +
    JCARD_STAT_DEFS.map(([k, label]) =>
      '<button type="button" class="term-cat' + (JCARD_OPTS[k] ? ' is-on' : '') + '" data-stat="' + k + '">' +
      '<i style="background:' + (JCARD_OPTS[k] ? '#03c988' : '#5c6472') + '"></i>' +
      label.charAt(0) + label.slice(1).toLowerCase() + '</button>').join('');
}

// ---- layout ----------------------------------------------------------------
// One source of truth for vertical positions, used to size the canvas BEFORE
// drawing (setting canvas.height resets the context, so measure first).
function jcardLayout(showCal, showAccts, statCount, acctRows){
  const L = { headerRule: 170, heroLabel: 280, heroVal: 420, heroDate: 475 };
  let y = 530;
  if (statCount > 0) {
    L.statsTop = y;
    L.statRows = Math.ceil(statCount / 4);
    y += L.statRows * 138 + 24;
  }
  if (showCal) {
    L.calTop = y + 8;
    const now = new Date();
    const firstDow = new Date(now.getFullYear(), now.getMonth(), 1).getDay();
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    L.calWeeks = Math.ceil((firstDow + daysInMonth) / 7);
    L.calCellH = Math.min(118, Math.floor(330 / L.calWeeks));
    y = L.calTop + 40 + L.calWeeks * (L.calCellH + 12) + 26;
  }
  if (showAccts && acctRows > 0) {
    L.acctTop = y + 8;
    y = L.acctTop + 40 + acctRows * 74 + 16;
  }
  L.height = Math.max(760, y + 130);
  return L;
}

function jcardAccountRows(){
  const firms = (typeof PF_DATA !== 'undefined' && PF_DATA.firms) ? PF_DATA.firms : [];
  const acctPnl = {};
  (JOURNAL_TRADES || []).forEach((t) => {
    if (typeof t.pnl !== 'number') return;
    const a = t.account || 'Personal';
    acctPnl[a] = (acctPnl[a] || 0) + t.pnl;
  });
  const rows = [];
  firms.slice(0, 3).forEach((f) => {
    const spent = (f.expenses || []).reduce((s, e) => s + (parseFloat(e.amount) || 0), 0);
    const received = (f.payouts || []).reduce((s, p) => s + (parseFloat(p.amount) || 0), 0);
    rows.push({ name: f.name, status: f.status, net: received - spent + (acctPnl[f.name] || 0) });
  });
  if (acctPnl['Personal']) rows.push({ name: 'Personal', status: null, net: acctPnl['Personal'] });
  return rows.slice(0, 4);
}

// ---- render ----------------------------------------------------------------
function jcardRender(){
  const canvas = document.getElementById('jcard-canvas');
  if (!canvas) return;
  const period = document.getElementById('jcard-period').value;
  const showCal = document.getElementById('jcard-cal').checked;
  const showAccts = document.getElementById('jcard-accts').checked;
  const currency = (JOURNAL_SETTINGS && JOURNAL_SETTINGS.currency) || 'USD';

  const trades = jcardPeriodTrades(period);
  const stats = journalAggregateStats(trades);
  const byDay = {};
  trades.forEach((t) => { byDay[t.date] = (byDay[t.date] || 0) + t.pnl; });
  const extras = {
    currency,
    bestDay: Object.keys(byDay).length ? Math.max(...Object.values(byDay)) : 0,
    bestTrade: trades.length ? Math.max(...trades.map((t) => t.pnl)) : 0
  };
  const tiles = JCARD_STAT_DEFS.filter(([k]) => JCARD_OPTS[k])
    .map(([k, label, fn]) => [label, fn(stats, extras)]);
  const acctRows = showAccts ? jcardAccountRows() : [];

  const L = jcardLayout(showCal, showAccts, tiles.length, acctRows.length);
  canvas.height = L.height;                     // resets the context state
  const H = L.height;
  const ctx = canvas.getContext('2d');

  const up = stats.totalPnl >= 0;
  const accent = up ? '#03c988' : '#e5484d';

  // ---- ground
  ctx.fillStyle = '#0a0c0b';
  ctx.fillRect(0, 0, JCARD_W, H);
  const glow = ctx.createRadialGradient(JCARD_W / 2, 400, 60, JCARD_W / 2, 400, 900);
  glow.addColorStop(0, up ? 'rgba(3,201,136,0.16)' : 'rgba(229,72,77,0.14)');
  glow.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, JCARD_W, H);

  // faint grid
  ctx.strokeStyle = 'rgba(255,255,255,0.025)';
  ctx.lineWidth = 1;
  for (let x = 0; x <= JCARD_W; x += 72) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
  for (let y = 0; y <= H; y += 72) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(JCARD_W, y); ctx.stroke(); }

  // frame
  ctx.strokeStyle = up ? 'rgba(3,201,136,0.35)' : 'rgba(229,72,77,0.35)';
  ctx.lineWidth = 2;
  ctx.strokeRect(36, 36, JCARD_W - 72, H - 72);

  // ---- header: the trader's own name when set, plain otherwise
  const name = (JCARD_NAME || '').trim();
  ctx.textAlign = 'left';
  ctx.font = '700 30px "JetBrains Mono", monospace';
  if (name) {
    ctx.fillStyle = accent;
    ctx.fillText('◆ ' + name.toUpperCase().slice(0, 22), 84, 130);
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.fillText('  ·  TRADE JOURNAL', 84 + ctx.measureText('◆ ' + name.toUpperCase().slice(0, 22)).width, 130);
  } else {
    ctx.fillStyle = accent;
    ctx.fillText('◆', 84, 130);
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.fillText(' TRADE JOURNAL', 84 + ctx.measureText('◆').width, 130);
  }

  ctx.textAlign = 'right';
  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.font = '700 26px "JetBrains Mono", monospace';
  ctx.fillText(JCARD_PERIOD_LABELS[period], JCARD_W - 84, 130);

  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.beginPath(); ctx.moveTo(84, L.headerRule); ctx.lineTo(JCARD_W - 84, L.headerRule); ctx.stroke();

  // ---- hero P&L
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.font = '600 28px "JetBrains Mono", monospace';
  ctx.fillText('NET P&L', JCARD_W / 2, L.heroLabel);

  ctx.fillStyle = accent;
  ctx.shadowColor = accent; ctx.shadowBlur = 40;
  ctx.font = '700 130px "JetBrains Mono", monospace';
  ctx.fillText(jcardMoney(stats.totalPnl, currency), JCARD_W / 2, L.heroVal);
  ctx.shadowBlur = 0;

  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  ctx.font = '400 26px "JetBrains Mono", monospace';
  const dateStr = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  ctx.fillText(dateStr, JCARD_W / 2, L.heroDate);

  // ---- stat tiles: 4 per row, as many rows as selected
  if (tiles.length) {
    const tw = (JCARD_W - 168 - 3 * 20) / 4;
    tiles.forEach((tile, i) => {
      const x = 84 + (i % 4) * (tw + 20);
      const ty = L.statsTop + Math.floor(i / 4) * 138;
      ctx.fillStyle = 'rgba(255,255,255,0.035)';
      ctx.strokeStyle = 'rgba(255,255,255,0.09)';
      ctx.beginPath();
      ctx.roundRect(x, ty, tw, 118, 14);
      ctx.fill(); ctx.stroke();
      ctx.textAlign = 'center';
      ctx.fillStyle = '#eeeeee';
      const long = tile[1].length > 8;
      ctx.font = '700 ' + (long ? 30 : 38) + 'px "JetBrains Mono", monospace';
      ctx.fillText(tile[1], x + tw / 2, 590 - 530 + ty);
      ctx.fillStyle = 'rgba(255,255,255,0.4)';
      ctx.font = '600 17px "JetBrains Mono", monospace';
      ctx.fillText(tile[0], x + tw / 2, 626 - 530 + ty);
    });
  }

  if (showCal) jcardDrawCalendar(ctx, L.calTop, currency);
  if (acctRows.length) jcardDrawAccounts(ctx, L.acctTop, currency, acctRows);

  // ---- footer: the subtle site mark
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(255,255,255,0.3)';
  ctx.font = '600 24px "JetBrains Mono", monospace';
  ctx.fillText('strykertrading.com', JCARD_W / 2, H - 78);
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
  const gy = top + 40;

  const firstDow = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const weeks = Math.ceil((firstDow + daysInMonth) / 7);
  const cellH = Math.min(cell, Math.floor(330 / weeks));

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
}

function jcardDrawAccounts(ctx, top, currency, rows){
  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.font = '600 24px "JetBrains Mono", monospace';
  ctx.fillText('ACCOUNTS', 84, top + 10);

  let y = top + 40;
  rows.forEach((r) => {
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
  const nameInput = document.getElementById('jcard-name');
  if (nameInput && !nameInput.value) nameInput.value = JCARD_NAME;
  jcardRenderStatChips();
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

  const nameInput = document.getElementById('jcard-name');
  if (nameInput) nameInput.addEventListener('input', () => {
    JCARD_NAME = nameInput.value.slice(0, 24);
    try { localStorage.setItem('stryker_jcard_name', JCARD_NAME); } catch (e) {}
    jcardRender();
  });

  const statsHost = document.getElementById('jcard-stats');
  if (statsHost) statsHost.addEventListener('click', (e) => {
    const btn = e.target.closest('.term-cat');
    if (!btn) return;
    if (btn.dataset.stat === '__all') {
      const turnOn = !JCARD_STAT_DEFS.every(([k]) => JCARD_OPTS[k]);
      JCARD_STAT_DEFS.forEach(([k]) => { JCARD_OPTS[k] = turnOn; });
    } else {
      JCARD_OPTS[btn.dataset.stat] = !JCARD_OPTS[btn.dataset.stat];
    }
    try { localStorage.setItem('stryker_jcard_opts', JSON.stringify(JCARD_OPTS)); } catch (e) {}
    jcardRenderStatChips();
    jcardRender();
  });
});
