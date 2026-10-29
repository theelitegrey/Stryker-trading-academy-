// TradeZoro — ZoroCharts "futures data is delayed" strip (ES module)
// Depends on: assets/rt-access.js (rtReady, isRealtimeAdmin, rtOnChange), the Vela workspace (ws.active.symbol),
// assets/rithmic-ui.js (window.STRYKER_RITHMIC.open, set once Connect broker has loaded), assets/auth.js (auth).
// Owner order 2026-10-30: CME futures are 10 minutes behind by CME rule unless the member (a) connects Rithmic,
// (b) has the $5/month Live Futures Data add-on, or (c) was approved by the Owner (all three make the server / the
// Rithmic provider real-time; this strip only reflects that). Slim strip between the toolbar and the chart, shown
// only on a CME futures symbol while the viewer is NOT real-time. X hides it for this tab session only.
import { rtReady, isRealtimeAdmin, rtOnChange } from './rt-access.js?v=732';

const SS_HIDE = 'stryker_data_banner_hide';
const SS_OPEN = 'stryker_open_connect';
const FUT = /^(futures|cme|cme_mini|cbot|cbot_mini|comex|comex_mini|nymex|nymex_mini):/i;
const BARE = /^[A-Z0-9]+1!$/i;
const css = `
.stkdb{ flex:none; display:flex; align-items:center; gap:8px; min-height:30px; padding:3px 8px 3px 12px; background:var(--bg-0); border-bottom:1px solid var(--line-soft); font-size:12.5px; color:var(--ink-1); }
.stkdb[hidden]{ display:none; }
.stkdb-i{ width:7px; height:7px; border-radius:50%; background:var(--amber,#f5c542); flex:none; }
.stkdb-t{ flex:1 1 auto; min-width:0; line-height:1.3; }
.stkdb-b{ flex:none; display:inline-flex; align-items:center; height:24px; padding:0 10px; border-radius:999px; font:600 12px/1 inherit; font-family:inherit; cursor:pointer; white-space:nowrap; text-decoration:none; border:1px solid rgba(3,201,136,.5); background:rgba(3,201,136,.14); color:var(--gold); }
.stkdb-b.alt{ background:transparent; border-color:var(--line); color:var(--ink-0); }
.stkdb-b:hover{ filter:brightness(1.15); }
.stkdb-x{ flex:none; width:24px; height:24px; border:0; background:transparent; color:var(--ink-2); font-size:17px; line-height:1; cursor:pointer; border-radius:6px; }
.stkdb-x:hover{ color:var(--ink-0); }
@media (max-width:600px){ .stkdb{ flex-wrap:wrap; row-gap:4px; padding:4px 6px 4px 10px; } .stkdb-t{ flex:1 1 100%; font-size:12px; } .stkdb-b{ height:26px; } .stkdb-x{ position:absolute; top:2px; right:4px; } .stkdb{ position:relative; } .stkdb-t{ padding-right:22px; } }
`;

export function installDataBanner(ws, opts = {}) {
  if (document.getElementById('stkdb')) return;
  const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
  const bar = document.createElement('div');
  bar.className = 'stkdb'; bar.id = 'stkdb'; bar.hidden = true; bar.setAttribute('role', 'status');
  bar.innerHTML = '<i class="stkdb-i" aria-hidden="true"></i><span class="stkdb-t">Futures data is 10 minutes delayed (CME rule).</span>' +
    '<button type="button" class="stkdb-b" id="stkdb-connect">Connect data source</button>' +
    '<a class="stkdb-b alt" id="stkdb-buy" href="checkout.html?plan=LiveData">Live data $5/mo</a>' +
    '<button type="button" class="stkdb-x" id="stkdb-x" aria-label="Dismiss">\u00d7</button>';
  const panel = document.querySelector('.stkchart-panel');
  if (!panel || !panel.parentNode) return;
  panel.parentNode.insertBefore(bar, panel);

  const signedIn = () => { try { return !!(typeof auth !== 'undefined' && auth && auth.currentUser); } catch (e) { return false; } };
  const rithLive = () => { try { return !!(opts.rith && opts.rith.client && opts.rith.client.state === 'connected'); } catch (e) { return false; } };
  const isCme = (sym) => { sym = String(sym || ''); if (/^fx:/i.test(sym)) return false; return FUT.test(sym) || BARE.test(sym); };
  let ready = false, hidden = false;
  try { hidden = sessionStorage.getItem(SS_HIDE) === '1'; } catch (e) {}

  function sync() {
    let sym = '';
    try { sym = ws.active ? ws.active.symbol : ''; } catch (e) {}
    const show = ready && !hidden && isCme(sym) && !rithLive() && !isRealtimeAdmin();
    if (bar.hidden === show) bar.hidden = !show;
    document.documentElement.classList.toggle('stk-delay-banner', show);
  }
  function openSheet() {
    const R = window.STRYKER_RITHMIC;
    if (R && typeof R.open === 'function') { R.open(); return true; }
    return false;
  }
  document.getElementById('stkdb-connect').addEventListener('click', () => {
    if (!signedIn()) {   // sign in first, then the sheet opens when ZoroCharts reloads
      try { sessionStorage.setItem(SS_OPEN, '1'); sessionStorage.setItem('stryker_return_to', location.pathname + location.search); } catch (e) {}
      location.href = 'login.html';
      return;
    }
    if (!openSheet()) {   // Connect broker module loads a moment after the first candles
      let n = 0; const t = setInterval(() => { if (openSheet() || ++n > 40) clearInterval(t); }, 250);
    }
  });
  // The add-on is sold only once plans/LiveData exists (the CoS writes it after a test-mode purchase works).
  // Until then the button says so instead of leading to a dead checkout.
  document.getElementById('stkdb-buy').addEventListener('click', (e) => {
    e.preventDefault();
    const go = () => { location.href = 'checkout.html?plan=LiveData'; };
    const soon = () => { try { if (window.showToast) window.showToast('info', 'Live futures data ($5/month) opens today. For now, connect your Rithmic login or ask us for approval.'); } catch (x) {} };
    if (!signedIn()) { try { sessionStorage.setItem('stryker_return_to', '/checkout.html?plan=LiveData'); } catch (x) {} go(); return; }
    try { db.collection('plans').doc('LiveData').get().then((d) => (d.exists && d.data().archived !== true ? go() : soon())).catch(soon); } catch (x) { soon(); }
  });
  document.getElementById('stkdb-x').addEventListener('click', () => {
    hidden = true; try { sessionStorage.setItem(SS_HIDE, '1'); } catch (e) {} sync();
  });

  // Came back from the sign-in this banner sent them to: open the sheet.
  try {
    if (sessionStorage.getItem(SS_OPEN) === '1' && signedIn()) {
      sessionStorage.removeItem(SS_OPEN);
      let n = 0; const t = setInterval(() => { if (openSheet() || ++n > 80) clearInterval(t); }, 250);
    }
  } catch (e) {}

  Promise.resolve(rtReady()).then(() => { ready = true; sync(); }).catch(() => { ready = true; sync(); });
  setTimeout(() => { ready = true; sync(); }, 6000);   // never wait forever on the auth answer
  rtOnChange(sync);
  ['state:changed', 'layout:changed', 'cell:active'].forEach((ev) => { try { ws.on(ev, sync); } catch (e) {} });
  if (opts.rith && opts.rith.client && opts.rith.client.on) opts.rith.client.on(sync);
  setInterval(sync, 2000);
  window.STRYKER_DATA_BANNER = { sync, el: bar };
}
