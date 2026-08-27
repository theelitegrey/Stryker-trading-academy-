// Stryker Trading Academy — Trade Journal: demo data
// One-click sample data so a student can explore every journal feature —
// dashboard, calendar, analytics, AI coach, prop-firm tracker, share card —
// before logging a single real trade. Everything written here is stamped
// demo:true so "Remove demo data" can cleanly delete ONLY the seeded rows
// and firms, never a real entry.
//
// Depends on: journal-calc.js (journalComputeDerived), journal-data.js
// (journalCollectionRef), journal-propfirms.js (PF_DATA, savePropFirms, pfId),
// journal-main.js (JOURNAL_UID, JOURNAL_SETTINGS, reloadJournalData).

// Deterministic PRNG (mulberry32) — same seed, same demo journal every time,
// which keeps the numbers stable across reloads and makes this testable.
function jdRng(seed){
  let a = seed >>> 0;
  return function(){
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const JD_FIRM_NAMES = ['FTMO 100K', 'Topstep 50K', 'Apex 150K'];

// Per-instrument market profile: realistic price zone, stop distance in
// points, and position size (points × size = dollars, matching how the
// journal computes P&L).
const JD_INSTRUMENTS = [
  { sym: 'NQ',     px: 19850, stopPts: [15, 45],    size: 20,   dec: 2, fee: 4.4 },
  { sym: 'ES',     px: 5630,  stopPts: [4, 12],     size: 50,   dec: 2, fee: 4.2 },
  { sym: 'XAUUSD', px: 2495,  stopPts: [3, 9],      size: 100,  dec: 2, fee: 7 },
  { sym: 'EURUSD', px: 1.093, stopPts: [0.0012, 0.003], size: 100000, dec: 5, fee: 6 },
  { sym: 'GBPUSD', px: 1.312, stopPts: [0.0015, 0.0035], size: 100000, dec: 5, fee: 6 }
];

const JD_SESSIONS = ['London', 'New York AM', 'New York PM', 'London/NY Overlap'];
const JD_SETUPS = ['FVG', 'Order Block', 'Liquidity Sweep', 'MSS', 'Silver Bullet', 'SMT', 'Judas Swing'];
const JD_NOTES_WIN = [
  'Clean sweep of Asia low, displaced through, entered on the retrace.',
  'Waited for the 9:30 open drive to settle — textbook entry.',
  'SMT divergence with ES confirmed the reversal. Held to target.',
  'Partialed at 2R, runner to full target.',
  'A+ model. No hesitation on entry.'
];
const JD_NOTES_LOSS = [
  'Stopped to the tick before it ran. Entry was early.',
  'Chopped out in lunch hours — should not have been trading this window.',
  'News spike took the stop. Sized correctly so damage contained.',
  'Forced a trade with no real setup after missing the first move.',
  'Moved my stop once. It cost me — never again.'
];

// Round a price to the instrument's decimals.
function jdRound(v, dec){ return parseFloat(v.toFixed(dec)); }

// Build the full demo trade list (pure — no Firestore, unit-testable).
// A few dozen trades across the last ~60 days: a believable but imperfect
// journal (~55% win rate, a couple of revenge-trade clusters, one oversized
// loss) so the AI coach and analytics have real material to critique.
function jdBuildTrades(settings){
  const rng = jdRng(20260827);
  const balance = (settings && settings.accountBalance) || 10000;
  const trades = [];
  const today = new Date();
  today.setHours(12, 0, 0, 0);

  let lastWasLoss = false;
  for (let back = 60; back >= 0; back--) {
    const d = new Date(today.getTime() - back * 86400000);
    const dow = d.getDay();
    if (dow === 0 || dow === 6) continue;          // weekends: markets closed
    if (rng() < 0.38) { lastWasLoss = false; continue; }  // no-trade day

    const perDay = rng() < 0.55 ? 1 : (rng() < 0.75 ? 2 : 3);
    for (let k = 0; k < perDay; k++) {
      const ins = JD_INSTRUMENTS[Math.floor(rng() * JD_INSTRUMENTS.length)];
      const long = rng() < 0.5;
      const revenge = lastWasLoss && rng() < 0.3;   // flaw: chasing a loss back
      const win = revenge ? rng() < 0.25 : rng() < 0.58;

      const stopPts = ins.stopPts[0] + rng() * (ins.stopPts[1] - ins.stopPts[0]);
      const rr = 1.4 + rng() * 1.8;                 // planned reward:risk
      const planBroken = !win && rng() < 0.22;      // flaw: let it run past stop
      const movePts = win ? stopPts * rr * (0.85 + rng() * 0.3)
                          : -stopPts * (planBroken ? 1.15 + rng() * 0.5 : 0.95 + rng() * 0.1);

      const entry = jdRound(ins.px * (0.99 + rng() * 0.02), ins.dec);
      const dir = long ? 1 : -1;
      const exit = jdRound(entry + dir * movePts, ins.dec);
      const stop = jdRound(entry - dir * stopPts, ins.dec);
      const target = jdRound(entry + dir * stopPts * rr, ins.dec);
      // Size so ~1R risks a sane slice of the account, scaled off the profile.
      const sizeScale = revenge ? 1.6 : 1;          // flaw: oversizing when tilted
      const size = jdRound(ins.size * sizeScale * (0.5 + rng()), 0);

      const hour = 7 + Math.floor(rng() * 9);
      const minute = Math.floor(rng() * 60);
      const accRoll = rng();
      const account = accRoll < 0.4 ? JD_FIRM_NAMES[0]
                    : accRoll < 0.65 ? JD_FIRM_NAMES[1]
                    : accRoll < 0.8 ? JD_FIRM_NAMES[2] : '';

      const tags = [];
      if (revenge) tags.push('Revenge trade', 'Plan broken');
      else if (planBroken) tags.push('Plan broken');
      else if (win && rng() < 0.5) tags.push('A+ setup', 'Plan followed');
      else tags.push('Plan followed');

      const raw = {
        date: d.toISOString().slice(0, 10),
        time: String(hour).padStart(2, '0') + ':' + String(minute).padStart(2, '0'),
        instrument: ins.sym,
        direction: long ? 'long' : 'short',
        entryPrice: entry, exitPrice: exit, positionSize: size,
        stopLoss: stop, takeProfit: target, fees: ins.fee,
        setup: JD_SETUPS[Math.floor(rng() * JD_SETUPS.length)],
        session: JD_SESSIONS[Math.floor(rng() * JD_SESSIONS.length)],
        tags: tags,
        notes: (win ? JD_NOTES_WIN : JD_NOTES_LOSS)[Math.floor(rng() * 5)],
        account: account,
        demo: true
      };
      const t = Object.assign(raw, journalComputeDerived(raw, balance));
      trades.push(t);
      lastWasLoss = t.pnl < 0;
    }
  }
  return trades;
}

// Demo prop-firm accounts — one of each lifecycle state, with fee/payout
// histories that line up with the demo trades' account names.
function jdBuildFirms(){
  const ago = (days) => new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  return [
    {
      id: pfId(), name: JD_FIRM_NAMES[0], status: 'funded', accountSize: 100000, demo: true,
      expenses: [
        { id: pfId(), label: 'Challenge fee', amount: 540, date: ago(88) },
        { id: pfId(), label: 'Data fee', amount: 39, date: ago(60) }
      ],
      payouts: [
        { id: pfId(), amount: 2240, date: ago(34), note: 'First payout' },
        { id: pfId(), amount: 3125, date: ago(6), note: 'Second payout' }
      ]
    },
    {
      id: pfId(), name: JD_FIRM_NAMES[1], status: 'evaluation', accountSize: 50000, demo: true,
      expenses: [
        { id: pfId(), label: 'Challenge fee', amount: 49, date: ago(52) },
        { id: pfId(), label: 'Challenge fee', amount: 49, date: ago(22) }
      ],
      payouts: []
    },
    {
      id: pfId(), name: JD_FIRM_NAMES[2], status: 'failed', accountSize: 150000, demo: true,
      expenses: [
        { id: pfId(), label: 'Challenge fee', amount: 167, date: ago(75) },
        { id: pfId(), label: 'Reset fee', amount: 167, date: ago(58) }
      ],
      payouts: []
    }
  ];
}

// ---- load / remove ----------------------------------------------------------
function jdLoadDemo(){
  const btn = document.getElementById('jd-load-btn');
  if (!JOURNAL_UID || !btn) return;
  if ((JOURNAL_TRADES || []).some((t) => t.demo)) {
    showToast('error', 'Demo data is already loaded — remove it first.');
    return;
  }
  btn.disabled = true;
  btn.textContent = 'Loading demo data…';

  const trades = jdBuildTrades(JOURNAL_SETTINGS);
  const col = journalCollectionRef(JOURNAL_UID);
  const chunks = [];
  for (let i = 0; i < trades.length; i += 350) chunks.push(trades.slice(i, i + 350));

  let done = Promise.resolve();
  chunks.forEach((chunk) => {
    done = done.then(() => {
      const batch = db.batch();
      chunk.forEach((t) => {
        batch.set(col.doc(), Object.assign({}, t, {
          createdAt: firebase.firestore.FieldValue.serverTimestamp(),
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        }));
      });
      return batch.commit();
    });
  });

  done.then(() => {
    // Deliberately NOT bumping the achievement counters — demo rows should
    // never award journal badges.
    PF_DATA.firms = PF_DATA.firms.filter((f) => !f.demo).concat(jdBuildFirms());
    return savePropFirms(JOURNAL_UID);
  }).then(() => {
    showToast('success', 'Demo journal loaded: ' + trades.length + ' trades + 3 prop-firm accounts.');
    return reloadJournalData();
  }).catch((err) => {
    console.error('Stryker: demo load failed', err);
    showToast('error', 'Could not load demo data — check your connection.');
  }).finally(() => {
    btn.disabled = false;
    btn.textContent = 'Load demo data';
  });
}

function jdRemoveDemo(){
  const btn = document.getElementById('jd-clear-btn');
  if (!JOURNAL_UID || !btn) return;
  const demoTrades = (JOURNAL_TRADES || []).filter((t) => t.demo && t.id);
  const hadFirms = (PF_DATA.firms || []).some((f) => f.demo);
  if (!demoTrades.length && !hadFirms) {
    showToast('error', 'No demo data found.');
    return;
  }
  btn.disabled = true;
  btn.textContent = 'Removing…';

  const col = journalCollectionRef(JOURNAL_UID);
  const chunks = [];
  for (let i = 0; i < demoTrades.length; i += 350) chunks.push(demoTrades.slice(i, i + 350));

  let done = Promise.resolve();
  chunks.forEach((chunk) => {
    done = done.then(() => {
      const batch = db.batch();
      chunk.forEach((t) => batch.delete(col.doc(t.id)));
      return batch.commit();
    });
  });

  done.then(() => {
    PF_DATA.firms = (PF_DATA.firms || []).filter((f) => !f.demo);
    return hadFirms ? savePropFirms(JOURNAL_UID) : null;
  }).then(() => {
    showToast('success', 'Demo data removed. Your real entries are untouched.');
    return reloadJournalData();
  }).catch((err) => {
    console.error('Stryker: demo removal failed', err);
    showToast('error', 'Could not remove demo data — check your connection.');
  }).finally(() => {
    btn.disabled = false;
    btn.textContent = 'Remove demo data';
  });
}

document.addEventListener('DOMContentLoaded', () => {
  const load = document.getElementById('jd-load-btn');
  const clear = document.getElementById('jd-clear-btn');
  if (load) load.addEventListener('click', jdLoadDemo);
  if (clear) clear.addEventListener('click', jdRemoveDemo);
});
