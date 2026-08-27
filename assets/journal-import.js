// Stryker Trading Academy — Trade Journal: CSV import & export
// Depends on: journal-calc.js, journal-data.js (journalCollectionRef),
// the JOURNAL_* globals, Firebase compat SDK.
//
// Import flow: pick a file -> parse -> auto-map headers against a synonym
// table (TradeZella/broker exports use wildly different names for the same
// column) -> show the mapping with a preview so the student can correct it
// -> batched Firestore writes. Rows may carry either entry/exit/size (P&L
// is computed) or a ready-made P&L column (stored as-is) — broker exports
// come in both shapes.

// ---- CSV parsing (quotes, embedded commas/newlines, CRLF) -------------------
function jiParseCsv(text){
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((v) => String(v).trim() !== ''));
}

// ---- column auto-mapping ----------------------------------------------------
const JI_FIELDS = [
  { key: 'date', label: 'Date', syn: ['date', 'open date', 'opened', 'entry date', 'trade date', 'time opened', 'open time', 'datetime', 'opening time'] },
  { key: 'time', label: 'Time', syn: ['time', 'entry time', 'open time'] },
  { key: 'instrument', label: 'Symbol', syn: ['symbol', 'instrument', 'ticker', 'pair', 'market', 'asset', 'contract', 'product'] },
  { key: 'direction', label: 'Side', syn: ['side', 'direction', 'type', 'action', 'buy/sell', 'position', 'long/short'] },
  { key: 'entryPrice', label: 'Entry price', syn: ['entry', 'entry price', 'open price', 'price in', 'avg entry', 'fill price', 'buy price', 'opening price'] },
  { key: 'exitPrice', label: 'Exit price', syn: ['exit', 'exit price', 'close price', 'price out', 'avg exit', 'sell price', 'closing price'] },
  { key: 'positionSize', label: 'Size', syn: ['size', 'qty', 'quantity', 'lots', 'contracts', 'volume', 'units', 'shares', 'position size'] },
  { key: 'pnl', label: 'P&L', syn: ['pnl', 'p&l', 'p/l', 'profit', 'net pnl', 'net p&l', 'net profit', 'realized', 'realized pnl', 'gain', 'result ($)', 'profit/loss'] },
  { key: 'fees', label: 'Fees', syn: ['fees', 'fee', 'commission', 'commissions', 'comm', 'swap', 'costs'] },
  { key: 'stopLoss', label: 'Stop loss', syn: ['stop', 'sl', 'stop loss', 'stoploss', 'stop price'] },
  { key: 'takeProfit', label: 'Take profit', syn: ['target', 'tp', 'take profit', 'takeprofit', 'target price', 'limit'] },
  { key: 'account', label: 'Account', syn: ['account', 'account name', 'acct', 'trading account', 'firm'] },
  { key: 'setup', label: 'Setup', syn: ['setup', 'strategy', 'playbook', 'model', 'pattern'] },
  { key: 'session', label: 'Session', syn: ['session', 'market session'] },
  { key: 'tags', label: 'Tags', syn: ['tags', 'labels', 'tag'] },
  { key: 'notes', label: 'Notes', syn: ['notes', 'note', 'comment', 'comments', 'description', 'journal'] }
];

function jiAutoMap(headers){
  const map = {};       // field key -> column index
  const used = new Set();
  const norm = headers.map((h) => String(h).toLowerCase().replace(/[^a-z0-9&/ ]+/g, ' ').replace(/\s+/g, ' ').trim());
  // exact synonym match first, then substring
  JI_FIELDS.forEach((f) => {
    let idx = norm.findIndex((h, i) => !used.has(i) && f.syn.indexOf(h) !== -1);
    if (idx === -1) idx = norm.findIndex((h, i) => !used.has(i) && f.syn.some((s) => s.length > 2 && h.indexOf(s) !== -1));
    if (idx !== -1) { map[f.key] = idx; used.add(idx); }
  });
  return map;
}

// ---- value normalisation ----------------------------------------------------
function jiNum(v){
  if (v === null || v === undefined) return null;
  let s = String(v).trim().replace(/[$€£¥,\s]/g, '');
  if (!s) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  const n = parseFloat(s);
  if (isNaN(n)) return null;
  return neg ? -n : n;
}

function jiDate(v){
  const s = String(v || '').trim();
  if (!s) return { date: null, time: null };
  // ISO datetime or date
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/);
  if (m) return { date: m[1] + '-' + m[2] + '-' + m[3], time: m[4] ? m[4] + ':' + m[5] : null };
  // D/M/Y or M/D/Y with -, / or . — disambiguate by value; ambiguous defaults
  // to M/D/Y (the common broker-export convention).
  m = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})(?:[ T](\d{1,2}):(\d{2}))?/);
  if (m) {
    let a = parseInt(m[1], 10), b = parseInt(m[2], 10), y = parseInt(m[3], 10);
    if (y < 100) y += 2000;
    let month, day;
    if (a > 12) { day = a; month = b; }
    else if (b > 12) { month = a; day = b; }
    else { month = a; day = b; }
    if (month < 1 || month > 12 || day < 1 || day > 31) return { date: null, time: null };
    return {
      date: y + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0'),
      time: m[4] ? String(m[4]).padStart(2, '0') + ':' + m[5] : null
    };
  }
  return { date: null, time: null };
}

function jiDirection(v){
  const s = String(v || '').trim().toLowerCase();
  if (/^(sell|short|s|sold)/.test(s)) return 'short';
  return 'long';
}

// ---- import state -----------------------------------------------------------
let JI_ROWS = [];        // parsed data rows
let JI_HEADERS = [];
let JI_MAP = {};

function jiOpenPicker(){
  document.getElementById('ji-file').click();
}

function jiHandleFile(file){
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    const rows = jiParseCsv(String(reader.result || ''));
    if (rows.length < 2) {
      showToast('error', 'That file has no data rows.');
      return;
    }
    JI_HEADERS = rows[0].map((h) => String(h).trim());
    JI_ROWS = rows.slice(1);
    JI_MAP = jiAutoMap(JI_HEADERS);
    if (JI_MAP.date === undefined || (JI_MAP.pnl === undefined && JI_MAP.entryPrice === undefined)) {
      showToast('error', 'Could not find the essentials — check the mapping below.');
    }
    jiRenderMapper();
  };
  reader.onerror = () => showToast('error', 'Could not read that file.');
  reader.readAsText(file);
}

function jiRenderMapper(){
  const panel = document.getElementById('ji-panel');
  if (!panel) return;
  panel.style.display = '';

  const colOptions = (selected) =>
    '<option value="">— skip —</option>' +
    JI_HEADERS.map((h, i) =>
      '<option value="' + i + '"' + (selected === i ? ' selected' : '') + '>' +
      escapeJournalHtml(h || ('column ' + (i + 1))) + '</option>').join('');

  document.getElementById('ji-map-grid').innerHTML = JI_FIELDS.map((f) =>
    '<label class="ji-map-row' + ((f.key === 'date' || f.key === 'pnl' || f.key === 'instrument') ? ' is-key' : '') + '">' +
      '<span>' + f.label + '</span>' +
      '<select class="journal-select" data-field="' + f.key + '">' + colOptions(JI_MAP[f.key]) + '</select>' +
    '</label>').join('');

  jiRenderPreview();
  document.getElementById('ji-count').textContent = JI_ROWS.length + ' rows found';
  panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function jiReadMapFromUi(){
  const map = {};
  document.querySelectorAll('#ji-map-grid select').forEach((sel) => {
    if (sel.value !== '') map[sel.dataset.field] = parseInt(sel.value, 10);
  });
  return map;
}

function jiRowToTrade(row, map){
  const get = (k) => (map[k] !== undefined ? row[map[k]] : null);
  const dt = jiDate(get('date'));
  if (!dt.date) return null;
  const explicitTime = String(get('time') || '').trim();
  const tagsRaw = String(get('tags') || '').trim();

  const trade = {
    date: dt.date,
    time: explicitTime ? explicitTime.slice(0, 5) : (dt.time || ''),
    instrument: String(get('instrument') || '').trim().toUpperCase().slice(0, 20) || 'IMPORTED',
    direction: jiDirection(get('direction')),
    entryPrice: jiNum(get('entryPrice')),
    exitPrice: jiNum(get('exitPrice')),
    positionSize: jiNum(get('positionSize')),
    fees: jiNum(get('fees')) || 0,
    stopLoss: jiNum(get('stopLoss')),
    takeProfit: jiNum(get('takeProfit')),
    setup: String(get('setup') || '').trim().slice(0, 40),
    session: String(get('session') || '').trim().slice(0, 40),
    account: String(get('account') || '').trim().slice(0, 40),
    tags: tagsRaw ? tagsRaw.split(/[;|]/).map((t) => t.trim()).filter(Boolean).slice(0, 8) : [],
    notes: String(get('notes') || '').trim().slice(0, 2000),
    imported: true
  };

  const balance = (JOURNAL_SETTINGS && JOURNAL_SETTINGS.accountBalance) || 0;
  const derived = journalComputeDerived(trade, balance);
  // A ready-made P&L column wins over (or fills in for) the computed one.
  const csvPnl = jiNum(get('pnl'));
  if (csvPnl !== null) {
    derived.pnl = csvPnl;
    derived.result = csvPnl > 0 ? 'Win' : (csvPnl < 0 ? 'Loss' : 'Breakeven');
    if (derived.riskAmount) derived.rMultiple = csvPnl / derived.riskAmount;
  }
  if (derived.pnl === null) return null;   // nothing usable in this row
  return Object.assign(trade, derived);
}

function jiRenderPreview(){
  const map = jiReadMapFromUi();
  if (!Object.keys(map).length) Object.assign(map, JI_MAP);
  const host = document.getElementById('ji-preview');
  if (!host) return;
  const sample = JI_ROWS.slice(0, 4).map((r) => jiRowToTrade(r, map)).filter(Boolean);
  if (!sample.length) {
    host.innerHTML = '<p class="term-empty">No row parses yet — assign at least Date plus either P&amp;L or Entry/Exit/Size.</p>';
    return;
  }
  const currency = (JOURNAL_SETTINGS && JOURNAL_SETTINGS.currency) || 'USD';
  host.innerHTML =
    '<div class="jz-table-wrap"><table class="jz-table"><thead><tr>' +
      '<th>Date</th><th>Symbol</th><th>Side</th><th>Entry</th><th>Exit</th><th>Size</th><th>P&amp;L</th><th>Setup</th>' +
    '</tr></thead><tbody>' +
    sample.map((t) =>
      '<tr>' +
        '<td>' + t.date + '</td>' +
        '<td><b>' + escapeJournalHtml(t.instrument) + '</b></td>' +
        '<td>' + (t.direction === 'short' ? 'Short' : 'Long') + '</td>' +
        '<td>' + (t.entryPrice ?? '—') + '</td>' +
        '<td>' + (t.exitPrice ?? '—') + '</td>' +
        '<td>' + (t.positionSize ?? '—') + '</td>' +
        '<td class="' + (t.pnl > 0 ? 'gm-up' : (t.pnl < 0 ? 'gm-down' : '')) + '">' + journalFormatCurrency(t.pnl, currency) + '</td>' +
        '<td>' + escapeJournalHtml(t.setup || '—') + '</td>' +
      '</tr>').join('') +
    '</tbody></table></div>' +
    '<p class="gm-fineprint">Preview of the first rows with the current mapping.</p>';
}

function jiRunImport(){
  const map = jiReadMapFromUi();
  const trades = JI_ROWS.map((r) => jiRowToTrade(r, map)).filter(Boolean);
  if (!trades.length) {
    showToast('error', 'No importable rows — check the column mapping.');
    return;
  }

  // Duplicate guard: skip rows identical to an existing trade on the fields
  // that identify one (date+time+symbol+pnl).
  const seen = new Set((JOURNAL_TRADES || []).map((t) =>
    [t.date, t.time || '', t.instrument || '', t.pnl].join('|')));
  const fresh = trades.filter((t) => !seen.has([t.date, t.time || '', t.instrument || '', t.pnl].join('|')));
  const skipped = trades.length - fresh.length;
  if (!fresh.length) {
    showToast('error', 'All ' + trades.length + ' rows already exist in your journal.');
    return;
  }

  const btn = document.getElementById('ji-import-btn');
  btn.disabled = true;
  btn.textContent = 'Importing ' + fresh.length + '…';

  const col = journalCollectionRef(JOURNAL_UID);
  const chunks = [];
  for (let i = 0; i < fresh.length; i += 350) chunks.push(fresh.slice(i, i + 350));

  let done = Promise.resolve();
  chunks.forEach((chunk) => {
    done = done.then(() => {
      const batch = db.batch();
      chunk.forEach((t) => {
        const ref = col.doc();
        batch.set(ref, Object.assign({}, t, {
          createdAt: firebase.firestore.FieldValue.serverTimestamp(),
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        }));
      });
      return batch.commit();
    });
  });

  done.then(() => {
    const counterUpdate = { journalEntryCount: firebase.firestore.FieldValue.increment(fresh.length) };
    if (fresh.some((t) => t.pnl > 0)) counterUpdate.hasWinningTrade = true;
    return db.collection('students').doc(JOURNAL_UID).set(counterUpdate, { merge: true }).catch(() => {});
  }).then(() => {
    showToast('success', 'Imported ' + fresh.length + ' trades' + (skipped ? ' (' + skipped + ' duplicates skipped)' : '') + '.');
    document.getElementById('ji-panel').style.display = 'none';
    JI_ROWS = []; JI_HEADERS = []; JI_MAP = {};
    document.getElementById('ji-file').value = '';
    return reloadJournalData();
  }).catch((err) => {
    console.error('Stryker: import failed', err);
    showToast('error', 'Import failed: ' + (err.message || err));
  }).finally(() => {
    btn.disabled = false;
    btn.textContent = 'Import trades';
  });
}

// ---- export -----------------------------------------------------------------
function jiExportCsv(){
  const trades = (JOURNAL_TRADES || []).slice().reverse();   // oldest first
  if (!trades.length) { showToast('error', 'Nothing to export yet.'); return; }
  const esc = (v) => {
    const s = String(v === null || v === undefined ? '' : v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const header = ['Date', 'Time', 'Symbol', 'Side', 'Entry', 'Exit', 'Size', 'Stop', 'Target', 'Fees', 'PnL', 'R', 'Setup', 'Session', 'Tags', 'Notes'];
  const lines = [header.join(',')].concat(trades.map((t) => [
    t.date, t.time, t.instrument, t.direction, t.entryPrice, t.exitPrice, t.positionSize,
    t.stopLoss, t.takeProfit, t.fees, t.pnl,
    (t.rMultiple !== null && t.rMultiple !== undefined) ? t.rMultiple.toFixed(2) : '',
    t.setup, t.session, (t.tags || []).join('|'), t.notes
  ].map(esc).join(',')));

  const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'stryker-trade-journal.csv';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

// ---- wiring -----------------------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
  const file = document.getElementById('ji-file');
  if (!file) return;
  document.getElementById('ji-open-btn').addEventListener('click', jiOpenPicker);
  file.addEventListener('change', () => jiHandleFile(file.files[0]));
  document.getElementById('ji-import-btn').addEventListener('click', jiRunImport);
  document.getElementById('ji-cancel-btn').addEventListener('click', () => {
    document.getElementById('ji-panel').style.display = 'none';
    file.value = '';
  });
  document.getElementById('ji-export-btn').addEventListener('click', jiExportCsv);
  document.getElementById('ji-map-grid').addEventListener('change', jiRenderPreview);
});
