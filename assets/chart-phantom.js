// TradeZoro Phantom Charts panel (right icon bar; phones: a sheet). Same panel system as the GEX Ladder (assets/chart-gex-ladder.js):
// it sits beside the chart (the chart's right edge moves left), never over it.
// Shows, for the chart's market: today's net call / net put premium, the Net impact of every covered symbol, the top strikes by
// premium and the day's biggest minutes (Whale moves). Tap a strike or a minute to open it on the Phantom page.
// Futures: ES/MES -> SPX, NQ/MNQ -> QQQ, GC/MGC -> GLD (assets/phantom-core.js phantomSource).
// Data: the recorder's /phantom/summary + /phantom/board (signed-in members, member token from assets/rt-access.js).
// COPY: estimated from options volume and quotes, per minute; "Updated X s ago"; Education only. Not financial advice.
import { rtHeadersReady } from './rt-access.js?v=1107';
import * as P from './phantom-core.js?v=1107';

const REC = () => window.__STK_BOOK_RECORDER || 'https://book-recorder.theelitegrey.workers.dev';
const PHONE_MAX = 700;
const REFRESH_MS = 60 * 1000;
const OTHERS = '.stkw-railbtn:not(.stkph-railbtn), .stkw-phonebtn, .stknw-phonebtn, .stkin-phonebtn, .stkgl-phonebtn';
const ICON = (s) => `<img src="/assets/images/phantom/phantom-20.png" srcset="/assets/images/phantom/phantom-20@2x.png 2x, /assets/images/phantom/phantom-20@3x.png 3x" width="${s}" height="${s}" alt="" aria-hidden="true" class="stkph-ic">`;
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function el(tag, attrs, html) { const n = document.createElement(tag); for (const [k, v] of Object.entries(attrs || {})) { if (k === 'class') n.className = v; else n.setAttribute(k, v === true ? '' : v); } if (html) n.innerHTML = html; return n; }

async function get(route, q) {
  let h = {};
  try { h = await rtHeadersReady(8000); } catch (e) {}
  const r = await fetch(REC() + '/phantom/' + route + '?' + new URLSearchParams(q), { headers: h, cache: 'no-store' });
  if (r.status === 401 || r.status === 403) return { locked: true };
  if (!r.ok) return null;
  if (route === 'board') return new Response(r.headers.get('x-ph-gzip') === '1' ? r.body.pipeThrough(new DecompressionStream('gzip')) : r.body).json();
  return r.json();
}

export function mountPhantom(ws, opts) {
  opts = opts || {};
  if (!ws || document.getElementById('stkph')) return null;
  const host = document.querySelector('.stkchart-panel.stkw-host') || document.querySelector('.stkchart-panel');
  if (!host) return null;
  const isPhone = () => window.innerWidth <= PHONE_MAX;
  let open = false, timer = 0, data = { u: null, sum: null, board: null, err: '' };
  const railBtn = el('button', { type: 'button', class: 'stkw-railbtn stkph-railbtn', title: 'Phantom: options money flow', 'aria-label': 'Phantom', 'aria-pressed': 'false' }, ICON(20));
  const phoneBtn = el('button', { type: 'button', class: 'stkc-btn stkph-phonebtn', title: 'Phantom', 'aria-label': 'Phantom' }, ICON(16) + '<span class="stkc-btn-l">Phantom</span>');
  const closeBtn = el('button', { type: 'button', class: 'stkw-ib stkph-close', title: 'Close', 'aria-label': 'Close Phantom' }, '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>');
  const panel = el('aside', { class: 'stkph', id: 'stkph', 'aria-label': 'Phantom', hidden: true });
  const hd = el('div', { class: 'stkph-hd' }, ICON(20) + '<span class="stkph-title">Phantom</span><span class="stkph-sym"></span><span class="stkph-sp"></span>');
  hd.appendChild(closeBtn);
  const body = el('div', { class: 'stkph-body' });
  const foot = el('p', { class: 'stkph-foot' }, 'Estimated from options volume and quotes, per minute. Education only. Not financial advice.');
  panel.append(hd, body, foot); host.appendChild(panel);
  const barR = document.querySelector('#stkc-bar .stkc-bar-r');
  if (barR) { const nb = barR.querySelector('.stkgl-phonebtn') || barR.querySelector('.stknw-phonebtn'); if (nb && nb.parentNode) nb.parentNode.insertBefore(phoneBtn, nb.nextSibling); else barR.insertBefore(phoneBtn, barR.firstChild); }

  const activeSym = () => { try { return ws.active.symbol; } catch (e) { return ''; } };
  const want = () => P.phantomSource(activeSym());

  async function refresh() {
    const u = want();
    data.u = u;
    if (!u) { render(); return; }
    const [sum, board] = await Promise.all([get('summary', {}), get('board', { u })]);
    if ((sum && sum.locked) || (board && board.locked)) { data.err = 'locked'; render(); return; }
    data.err = ''; data.sum = sum; data.board = board; data.at = Date.now();
    render();
  }
  function render() {
    const u = data.u;
    const root = activeSym().split(':').pop().toUpperCase().replace(/[0-9]?!$/, '');
    hd.querySelector('.stkph-sym').textContent = !u ? '' : root === u ? u : root + ' \u2192 ' + u;   // futures show their options source
    if (!u) { body.innerHTML = '<div class="stkph-note">Phantom covers SPX, SPY, QQQ and GLD options. On futures charts ES and MES use SPX, NQ and MNQ use QQQ, GC and MGC use GLD. Open one of those to see its flow.</div>'; return; }
    if (data.err === 'locked') { body.innerHTML = '<div class="stkph-note">Sign in to see Phantom. It is free with an account.<a class="stkph-link" href="/login">Log in</a></div>'; return; }
    const b = data.board, x = data.sum && data.sum.u && data.sum.u[u];
    if (!b || !x) { body.innerHTML = '<div class="stkph-note">No Phantom data for ' + u + ' yet. It starts with the first options update of a US session.</div>'; return; }
    if (window.__stkReplay && window.__stkReplay.on) { body.innerHTML = '<div class="stkph-note">Bar replay is on. Phantom shows the current session, so it is hidden here.</div>'; return; }
    const tot = x.tot || {};
    const imp = P.netImpact(data.sum), max = Math.max(1, ...imp.map((i) => Math.abs(i.net)));
    const rows = P.boardRows(b), cut = P.topCut(rows, 5);
    const top = rows.filter((r) => r.p > 0).sort((a, c) => c.p - a.p).slice(0, 12);
    const wh = P.filterWhales(P.whaleRows(x.moves, x.mcols, u, data.sum.day), {}).slice(0, 15);
    body.innerHTML = `
      <div class="stkph-upd" data-t="${b.t}">${esc(P.agoText(b.t))}</div>
      <div class="stkph-tot"><div><span>Net calls</span><b class="${(tot.cn || 0) >= 0 ? 'pos' : 'neg'}">${P.usd(tot.cn, true)}</b></div><div><span>Net puts</span><b class="${(tot.pn || 0) >= 0 ? 'pos' : 'neg'}">${P.usd(tot.pn, true)}</b></div></div>
      <h3 class="stkph-h">Net impact</h3>
      <div class="stkph-imp">${imp.map((i) => `<div class="stkph-ir${i.u === u ? ' on' : ''}"><span class="stkph-iu">${i.u}</span><span class="stkph-it"><span class="stkph-im"></span><span class="stkph-ib ${i.net >= 0 ? 'pos' : 'neg'}" style="${i.net >= 0 ? 'left' : 'right'}:50%;width:${(Math.abs(i.net) / max * 50).toFixed(1)}%"></span></span><span class="stkph-iv ${i.net >= 0 ? 'pos' : 'neg'}">${P.usd(i.net, true)}</span></div>`).join('')}</div>
      <h3 class="stkph-h">Top strikes today</h3>
      <div class="stkph-scroll"><table class="stkph-tbl"><thead><tr><th>Strike</th><th>Expiry</th><th>Side</th><th class="num">Premium</th><th class="num">Vol/OI</th></tr></thead><tbody>
      ${top.map((r) => { const f = P.flagsOf(r, cut); return `<tr data-k="${r.k}"><th>${P.fmtStrike(r.strike)}</th><td>${P.fmtExp(r.exp)}</td><td class="${r.cp === 'C' ? 'pos' : 'neg'}">${r.cp === 'C' ? 'Call' : 'Put'}</td><td class="num">${P.usd(r.p)}</td><td class="num${f.vo ? ' hot' : ''}">${P.fmtVo(r.vo)}</td></tr>`; }).join('')}
      </tbody></table></div>
      <h3 class="stkph-h">Whale moves <small>biggest minutes</small></h3>
      <div class="stkph-scroll"><table class="stkph-tbl"><thead><tr><th>Time</th><th>Strike</th><th>Side</th><th class="num">Est. premium</th><th class="num">Vol/OI</th></tr></thead><tbody>
      ${wh.length ? wh.map((w) => `<tr data-k="${w.k}"><th>${P.fmtTime(w.t * 1000)}</th><td>${P.fmtStrike(w.strike)} <small>${P.fmtExp(w.exp)}</small></td><td class="${w.cp === 'C' ? 'pos' : 'neg'}">${w.cp === 'C' ? 'Call' : 'Put'}</td><td class="num">${P.usd(w.p)}</td><td class="num${w.vo > 1 ? ' hot' : ''}">${P.fmtVo(w.vo)}</td></tr>`).join('') : '<tr><td colspan="5" class="stkph-empty">No minutes over $25K yet.</td></tr>'}
      </tbody></table></div>
      <a class="stkph-link" href="/phantom?u=${u}" target="_blank" rel="noopener">Open Phantom: board, contract detail, alerts</a>`;
  }
  body.addEventListener('click', (e) => { const r = e.target.closest('tr[data-k]'); if (r && data.u) window.open('/phantom?u=' + data.u + '#' + r.dataset.k, '_blank', 'noopener'); });
  setInterval(() => { const u = body.querySelector('.stkph-upd'); if (u && open) u.textContent = P.agoText(+u.dataset.t); }, 5000);

  const wlOpen = () => host.classList.contains('stkw-open');
  function closeOthers() {
    if (wlOpen()) { const b = document.querySelector('.stkw .stkw-close'); if (b) b.click(); }
    try { if (window.__stkNews && window.__stkNews.isOpen) window.__stkNews.close(); } catch (e) {}
    try { if (window.__stkSymInfo && window.__stkSymInfo.isOpen) window.__stkSymInfo.close(); } catch (e) {}
    try { if (window.__stkGexLadder && window.__stkGexLadder.isOpen) window.__stkGexLadder.close(); } catch (e) {}
  }
  function setOpen(v) {
    open = !!v;
    if (open) closeOthers();
    panel.hidden = !open;
    host.classList.toggle('stkph-open', open);
    document.documentElement.classList.toggle('stkph-sheet', open && isPhone());
    railBtn.setAttribute('aria-pressed', String(open)); railBtn.classList.toggle('on', open); phoneBtn.classList.toggle('on', open);
    clearInterval(timer); timer = 0;
    if (open) { body.innerHTML = '<div class="stkph-note">Loading…</div>'; refresh(); timer = setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, REFRESH_MS); }
    requestAnimationFrame(() => { try { window.dispatchEvent(new Event('resize')); } catch (e) {} });
  }
  function placeRail() {
    const rail = document.querySelector('.stkw-rail'); if (!rail) return false;
    if (railBtn.parentNode !== rail) { const after = rail.querySelector('.stkgl-railbtn') || rail.querySelector('.stkw-railbtn'); rail.insertBefore(railBtn, after ? after.nextSibling : rail.firstChild); }
    return true;
  }
  if (!placeRail()) { const mo = new MutationObserver(() => { if (placeRail()) mo.disconnect(); }); mo.observe(host, { childList: true, subtree: true }); setTimeout(() => mo.disconnect(), 30000); }
  railBtn.addEventListener('click', () => setOpen(!open));
  phoneBtn.addEventListener('click', (e) => { e.stopPropagation(); setOpen(!open); });
  closeBtn.addEventListener('click', () => setOpen(false));
  document.addEventListener('click', (e) => { if (open && e.target.closest && e.target.closest(OTHERS)) setTimeout(() => setOpen(false), 0); }, true);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && open && isPhone()) setOpen(false); });
  window.addEventListener('resize', () => { document.documentElement.classList.toggle('stkph-sheet', open && isPhone()); }, { passive: true });
  let lastU = null;
  try { ws.on('state:changed', () => { const u = want(); if (open && u !== lastU) { lastU = u; refresh(); } }); } catch (e) {}
  const api = { open: () => setOpen(true), close: () => setOpen(false), get isOpen() { return open; }, get u() { return data.u; }, refresh };
  window.__stkPhantom = api;
  return api;
}
