// TradeZoro: one shared way to give a PUBLIC-AND-APP page the app shell when the visitor is signed in.
//
//   signed in  -> app header (.mobile-topnav), side menu (.sidebar), bottom dock, .dash-main
//   signed out -> the page's own marketing header + footer, no app chrome
//
// The switch is CSS only: assets/style.css ("dual-shell" block) keys off html.nav-authed, which
// app-nav.js sets from the stored flag at first paint and then from the real auth state.
// Used by tools/app-shell/apply.js (hand-written pages) and tools/gen-learn.js (generated pages).
// Member-only pages do NOT use this: they carry the shell directly (see docs/DESIGN-STANDARD.md).
'use strict';
const fs = require('fs');
const path = require('path');

const SHELL = fs.readFileSync(path.join(__dirname, 'shell.html'), 'utf8').trim();
const DOCK = fs.readFileSync(path.join(__dirname, 'dock.html'), 'utf8');
const SHELL_SCRIPTS = ['notifications.js', 'push.js', 'admin-link.js', 'profiles-sync.js', 'loading-animation.js',
  'avatars.js', 'account-menu.js', 'referrals.js', 'roles.js', 'plan-price.js', 'plan-modal.js', 'trial.js',
  'maintenance-check.js', 'branding.js', 'dash-nav.js'];
const FB_MESSAGING = 'https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js';
const AUTHED_SNIPPET = "<script>try{if(localStorage.getItem('stryker_nav_authed')==='1')document.documentElement.classList.add('nav-authed')}catch(e){}</script>";

function toDual(html, opts) {
  opts = opts || {};
  if (html.includes('dual-shell')) return html;                   // already converted
  const ver = (html.match(/assets\/theme\.js\?v=(\d+)/) || [])[1];
  if (!ver) throw new Error('theme.js tag not found');
  // body class
  html = html.replace(/<body([^>]*)>/, (m, a) => /class="/.test(a) ? '<body' + a.replace('class="', 'class="dual-shell ') + '>' : '<body' + a + ' class="dual-shell">');
  // marketing header and footer get the hide-when-signed-in marker
  html = html.replace('<nav class="nav" id="site-nav">', '<nav class="nav dual-pub" id="site-nav">').replace('<nav class="nav cx-pubnav" id="site-nav">', '<nav class="nav dual-pub" id="site-nav">');
  if (!html.includes('dual-pub')) throw new Error('marketing nav not found');
  html = html.replace(/\n<footer>/, '\n<footer class="dual-pub">');
  // dock + app-nav.js right after the skip link (if the page has none yet)
  if (!html.includes('id="appnav-dock"')) {
    const pre = html.includes('src="/assets/') ? '/' : '';
    html = html.replace(/(<a class="skip-link"[^>]*>[^<]*<\/a>\n)/, '$1' + DOCK + '<script src="' + pre + 'assets/app-nav.js?v=' + ver + '"></script>\n');
  }
  // the shell: app header + side menu, then <main> becomes .dash-main inside .dash-shell
  let shell = SHELL.replace('<div class="mobile-topnav">', '<div class="mobile-topnav dual-app">')
    .replace('<div class="sidebar-backdrop"', '<div class="sidebar-backdrop dual-app"')
    .replace('<aside class="sidebar">', '<aside class="sidebar dual-app">');
  if (opts.active) {
    // the active item is marked at run time by assets/app-nav.js (buildMenu); opts.active is kept for old callers
  }
  const mm = html.match(/<main\b([^>]*)>/);
  if (!mm) throw new Error('<main> not found');
  const attrs = /class="/.test(mm[1]) ? mm[1].replace('class="', 'class="dash-main ') : mm[1] + ' class="dash-main"';
  const open = mm.index;
  // the sidebar must be a direct child of .dash-shell (style.css drawer rules are `.dash-shell > .sidebar`)
  const ai = shell.indexOf('<aside');
  html = html.slice(0, open) + shell.slice(0, ai).trimEnd() + '\n<div class="dash-shell dual-wrap">\n' + shell.slice(ai) + '\n<main' + attrs + '>' + html.slice(open + mm[0].length);
  html = html.replace('</main>', '</main>\n</div>');
  // head: stored-auth flag at first paint
  if (!/<head>[\s\S]*stryker_nav_authed[\s\S]*<\/head>/.test(html)) html = html.replace('</head>', AUTHED_SNIPPET + '\n</head>');
  // scripts the shell needs, before theme.js
  let add = '';
  for (const n of SHELL_SCRIPTS) {
    if (new RegExp('assets/' + n.replace('.', '\\.')).test(html)) continue;
    if (n === 'push.js' && !html.includes(FB_MESSAGING)) add += '<script src="' + FB_MESSAGING + '"></script>\n';
    add += '<script src="/assets/' + n + '?v=' + ver + '"></script>\n';
  }
  html = html.replace(/<script src="[^"]*assets\/theme\.js[^"]*"><\/script>/, (m) => add + m);
  return html;
}
module.exports = { toDual };
