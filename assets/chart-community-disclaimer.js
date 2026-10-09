// Stryker Trading Academy — Charts: Community Indicators Disclaimer (ES module)
// Depends on: assets/chart-pine-builtins.js (BUILTIN_PINE: entries with section 'community'
// are third-party scripts); assets/chart-pine.js (window.STRYKER_PINE.addShared / addSource,
// wrapped here); assets/chart-indicator-window.js (the Indicators window: .stkiw-list,
// .stkiw-tab[data-k], .stkiw-grp headings). Loaded by charts.html.
//
// WHAT IT DOES (Owner order 2026-10-08 "also add a Community Indicators Disclaimer"):
//  1. A one-line notice at the top of the Community section of the Indicators window (and
//     above the "Community" heading in search results), with "Read full disclaimer" that
//     expands the full text in place.
//  2. A one-time "I understand" acknowledgement the first time a member adds ANY community
//     indicator: a Community library script (STRYKER_PINE.addShared) or a built-in whose
//     BUILTIN_PINE section is 'community' (STRYKER_PINE.addSource). Remembered in
//     localStorage per member uid (and once for signed-out use); never asked again.
// Kept in its own module so the picker file can change without losing the notice: it only
// watches the window's DOM and never edits it beyond inserting its own .stkcd-* nodes.

import { BUILTIN_PINE } from './chart-pine-builtins.js?v=480';

const ACK_LS = 'stryker_community_disclaimer_ack_v1';
// Owner order 2026-10-08: only Top and Trending carry third-party scripts; Editors' picks and
// BUILT-IN > Stryker list Stryker's own scripts, so no notice there.
const COMMUNITY_TABS = new Set(['top', 'trending']);
const SHORT = 'Community indicators are made by third-party members, not by Stryker. Education only. Not financial advice.';
const TITLE = 'Community Indicators Disclaimer';
const FULL = [
  'Indicators listed in the Community Indicators section are created and uploaded by independent third-party members of the community and are not developed, verified, endorsed, or guaranteed by Stryker Trading Academy.',
  'Stryker Trading Academy does not guarantee the accuracy, reliability, performance, security, or profitability of any community-submitted indicator. These tools are provided for educational and informational purposes only and should not be considered financial, investment, or trading advice.',
  'Users are responsible for independently reviewing, testing, and evaluating any indicator before using it. Trading involves substantial risk, and past or simulated performance does not guarantee future results.',
  'By downloading, installing, or using a community indicator, you acknowledge that you do so at your own risk. Stryker Trading Academy is not responsible for any trading losses, damages, technical issues, data loss, or other consequences arising from the use of any community indicator.'
];

function h(tag, attrs, kids){
  const n = document.createElement(tag);
  if (attrs) for (const k in attrs) {
    const v = attrs[k];
    if (v == null || v === false) continue;
    if (k === 'text') n.textContent = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? '' : v);
  }
  (kids || []).forEach((c) => { if (c) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
  return n;
}
function uid(){ try { return (typeof firebase !== 'undefined' && firebase.apps && firebase.apps.length && firebase.auth().currentUser) ? firebase.auth().currentUser.uid : ''; } catch (e) { return ''; } }
function readAck(){ try { return JSON.parse(localStorage.getItem(ACK_LS) || '{}') || {}; } catch (e) { return {}; } }
function acked(){ const a = readAck(); return !!a[uid() || '_anon']; }
function saveAck(){ const a = readAck(); a[uid() || '_anon'] = Date.now(); try { localStorage.setItem(ACK_LS, JSON.stringify(a)); } catch (e) {} }

function fullText(){ return h('div', { class: 'stkcd-full' }, FULL.map((p) => h('p', { text: p }))); }

// ---- 1. the notice in the Indicators window ----
function banner(){
  const more = h('button', { type: 'button', class: 'stkcd-more', 'aria-expanded': 'false', text: 'Read full disclaimer' });
  const body = h('div', { class: 'stkcd-body', hidden: true }, [h('p', { class: 'stkcd-t', text: TITLE }), fullText()]);
  more.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = body.hidden;
    body.hidden = !open;
    more.setAttribute('aria-expanded', open ? 'true' : 'false');
    more.textContent = open ? 'Hide full disclaimer' : 'Read full disclaimer';
  });
  return h('div', { class: 'stkcd-note', role: 'note', 'aria-label': TITLE }, [
    h('p', { class: 'stkcd-line' }, [h('span', { text: SHORT + ' ' }), more]), body
  ]);
}
function decorate(list){
  if (!list || list.querySelector(':scope > .stkcd-note')) return;
  const tab = document.querySelector('.stkiw-tab[aria-selected="true"]');
  const grp = [...list.querySelectorAll(':scope > .stkiw-grp')].find((g) => /^community\b/i.test(g.textContent.trim()));
  if (grp) list.insertBefore(banner(), grp);
  else if (tab && COMMUNITY_TABS.has(tab.dataset.k)) list.insertBefore(banner(), list.firstChild);
}
let pending = false;
new MutationObserver(() => {
  if (pending) return;
  pending = true;
  requestAnimationFrame(() => { pending = false; document.querySelectorAll('.stkiw-list').forEach(decorate); });
}).observe(document.body, { childList: true, subtree: true });

// ---- 2. the one-time acknowledgement ----
let asking = null;
export function confirmCommunity(){
  if (acked()) return Promise.resolve(true);
  if (asking) return asking;
  asking = new Promise((resolve) => {
    const prevFocus = document.activeElement;
    const done = (ok) => { if (ok) saveAck(); ov.remove(); document.removeEventListener('keydown', onKey, true); asking = null; try { prevFocus && prevFocus.focus && prevFocus.focus(); } catch (e) {} resolve(ok); };
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); done(false); } };
    const ok = h('button', { type: 'button', class: 'stkcd-ok', text: 'I understand', onclick: () => done(true) });
    const card = h('div', { class: 'stkcd-card', role: 'alertdialog', 'aria-modal': 'true', 'aria-labelledby': 'stkcd-h' }, [
      h('h2', { id: 'stkcd-h', text: TITLE }),
      h('div', { class: 'stkcd-scroll' }, [fullText()]),
      h('div', { class: 'stkcd-acts' }, [h('button', { type: 'button', class: 'stkcd-cancel', text: 'Cancel', onclick: () => done(false) }), ok])
    ]);
    // .stkc-dialog: the Indicators window leaves Escape to an open dialog with this class.
    const ov = h('div', { class: 'stkc-dialog stkcd-ov', onclick: (e) => { if (e.target === ov) done(false); } }, [card]);
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(ov);
    setTimeout(() => ok.focus(), 0);
  });
  return asking;
}
const NOT_ADDED = { ok: false, msg: 'Not added. Accept the Community indicators disclaimer to add it.' };
const communityNames = () => new Set(BUILTIN_PINE.filter((b) => b.section === 'community').map((b) => b.name));

function wrap(P){
  if (!P || P.__stkcdWrapped) return;
  P.__stkcdWrapped = true;
  const addShared = P.addShared, addSource = P.addSource;
  if (addShared) P.addShared = async function (s){ if (!(await confirmCommunity())) return NOT_ADDED; return addShared.apply(this, arguments); };
  if (addSource) P.addSource = async function (name){ if (communityNames().has(name) && !(await confirmCommunity())) return NOT_ADDED; return addSource.apply(this, arguments); };
}
(function hook(n){
  if (window.STRYKER_PINE) { wrap(window.STRYKER_PINE); return; }
  if (n < 240) setTimeout(() => hook(n + 1), 500);
})(0);

window.StrykerCommunityDisclaimer = { confirm: confirmCommunity, acked, SHORT, FULL, TITLE, KEY: ACK_LS };
