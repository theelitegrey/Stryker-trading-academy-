// TradeZoro — Charts "Trade" button + connection menu (Owner order 2026-11-16: logo of the connection, better button).
// Pure view code: chart-paper.js owns the actions (data-a = paper | live | connect) and calls draw()/button()/keys() below.
// Broker names + logos only ever appear when `live` is passed, which only the admin-only live module provides.
const ALIAS = { interactivebrokers: 'ibkr', interactivebroker: 'ibkr', ib: 'ibkr', tasty: 'tastytrade', tastyworks: 'tastytrade', ninja: 'ninjatrader', topstep: 'topstepx', coinbaseadvanced: 'coinbase', binanceus: 'binance' };
const KNOWN = new Set(['tradovate', 'rithmic', 'ninjatrader', 'ibkr', 'tastytrade', 'alpaca', 'tradier', 'schwab', 'tradestation', 'webull', 'robinhood', 'coinbase', 'binance', 'kraken', 'topstepx', 'projectx']);
const HUES = ['#2563eb', '#7c3aed', '#db2777', '#ea580c', '#0d9488', '#4f46e5'];
const esc = (t) => String(t == null ? '' : t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const brokerKey = (name) => { const k = String(name || '').toLowerCase().replace(/[^a-z0-9]/g, ''); return ALIAS[k] || k; };
// 24px rounded-square mark: the local SVG when we have one, else a coloured square with the initial (also the onerror fallback).
export function logo(name, size) {
  const k = brokerKey(name), ini = esc((String(name || '?').trim()[0] || '?').toUpperCase());
  const hue = HUES[[...k].reduce((n, c) => n + c.charCodeAt(0), 0) % HUES.length];
  const fb = '<span class="stktm-fb" style="background:' + hue + '">' + ini + '</span>';
  return '<span class="stktm-logo stktm-s' + size + '" aria-hidden="true">' + (KNOWN.has(k) ? '<img src="assets/img/brokers/' + k + '.svg" alt="" width="' + size + '" height="' + size + '" data-fb="' + esc(fb) + '">' : fb) + '</span>';
}
const PAPER_IC = '<span class="stktm-logo stktm-paper" aria-hidden="true"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5M10 13h6M10 17h4"/></svg></span>';
const CHK = '<svg class="stktm-chk" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12 5 5 9-10"/></svg>';

function status(a, live) {
  const act = live.acct && live.acct.id === a.id;
  if (act && live.readErr && /renew/i.test(live.readErr)) return { t: 'Needs reconnect', c: 'bad' };
  if (act) return live.env && live.env.enabled === false ? { t: 'Connected · View only', c: 'warn' } : { t: 'Connected · Trading on', c: 'ok' };
  return { t: 'Connected', c: 'ok' };
}
const item = (attrs, icon, name, sub, on, extra) => '<button type="button" role="menuitemradio" class="stkc-item stktm-row" ' + attrs + ' aria-checked="' + !!on + '" tabindex="-1">' + icon +
  '<span class="stktm-tx"><span class="stktm-nm">' + name + '</span><span class="stktm-sub">' + (extra || '') + sub + '</span></span>' + (on ? CHK : '') + '</button>';

// live = window.__stkLive.state or null (members); paperBal = formatted paper balance text or ''
export function draw(pop, live, paperBal) {
  const act = live && live.acct;
  let h = '<div role="group" aria-labelledby="stktm-h1"><div class="stktm-h" id="stktm-h1">Paper</div>' +
    item('data-a="paper"', PAPER_IC, 'Paper trading', 'Simulated' + (paperBal ? ' · balance ' + esc(paperBal) : ''), !act) + '</div>';
  if (live) {
    h += '<div role="group" aria-labelledby="stktm-h2"><div class="stktm-h" id="stktm-h2">Live accounts</div>';
    if (!live.accounts.length) h += '<div class="stktm-empty">No broker connected yet.</div>';
    h += live.accounts.map((a) => { const s = status(a, live); return item('data-a="live" data-id="' + esc(a.id) + '"', logo(a.broker, 24), esc(a.broker) + ' <span class="stktm-mask">…' + esc(a.last4) + '</span>', esc(s.t), act && act.id === a.id, '<i class="stktm-dot ' + s.c + '" aria-hidden="true"></i>'); }).join('') + '</div>';
    h += '<div class="stktm-foot"><button type="button" role="menuitem" class="stktm-add" data-a="connect" tabindex="-1"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>Connect a broker</button><a class="stktm-manage" role="menuitem" href="trade-journal.html#jb-panel" tabindex="-1">Manage</a></div>';
  }
  pop.innerHTML = h;
  pop.querySelectorAll('img[data-fb]').forEach((i) => i.addEventListener('error', () => { i.parentNode.innerHTML = i.dataset.fb; }, { once: true }));
}
// Trade button face: logo/icon + name (+ live dot). Returns the text for aria/phone label.
export function button(b, live) {
  const act = live && live.acct, name = act ? act.broker : 'Paper';
  const sig = act ? act.id + '|' + name + '|' + (live.env && live.env.env) : 'paper';
  if (b.dataset.tmSig !== sig) {
    b.dataset.tmSig = sig;
    b.innerHTML = (act ? logo(name, 16) + '<i class="stktm-live" aria-hidden="true"></i>' : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 17 17 7M9 7h8v8"/></svg>') + '<span class="stkc-btn-l">' + esc(name) + '</span><svg class="stktm-caret" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
    b.querySelectorAll('img[data-fb]').forEach((i) => i.addEventListener('error', () => { i.parentNode.innerHTML = i.dataset.fb; }, { once: true }));
  }
  return act ? ((live.env && live.env.env === 'sandbox' ? 'SANDBOX ' : 'LIVE ') + name) : 'Paper';
}
// Arrow keys / Home / End move between rows; Enter/Space use the button's own click.
export function keys(pop, e) {
  const els = [...pop.querySelectorAll('[role^=menuitem]')]; if (!els.length) return false;
  const i = els.indexOf(document.activeElement); let n = -1;
  if (e.key === 'ArrowDown') n = (i + 1) % els.length; else if (e.key === 'ArrowUp') n = (i <= 0 ? els.length : i) - 1; else if (e.key === 'Home') n = 0; else if (e.key === 'End') n = els.length - 1;
  if (n < 0) return false; e.preventDefault(); els[n].focus(); return true;
}
export const focusFirst = (pop) => { const e = pop.querySelector('[aria-checked="true"]') || pop.querySelector('[role^=menuitem]'); if (e) e.focus(); };
