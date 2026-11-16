// TradeZoro desktop: which URL may load where, and the market-hours rule for update prompts.
// Pure functions, no Electron import, so test/policy.test.js runs them under plain node.
//
// Three places a URL can end up:
//   'app'      a TradeZoro page. Loads in a TradeZoro window (the only kind that gets the preload bridge).
//   'popup'    a sign-in / payment step (Google + Firebase auth, Razorpay checkout). Opens as a sandboxed
//              child window inside the app, so the result comes back to the page that asked for it.
//   'oauth'    a broker's own sign-in page for "Connect your own data" (Alpaca, tastytrade, cTrader...).
//              The site sends the main window there with location.assign and the broker redirects back
//              to tradezoro.com/connect/<id>/callback, so it must stay in the app or the token lands in
//              the system browser instead. No preload there.
//   'external' anything else on http(s) or mailto: handed to the normal browser / mail app.
//   'block'    everything else (file:, javascript:, data:, custom schemes...).

const APP_HOSTS = ['tradezoro.com', 'www.tradezoro.com'];

// Hosts a sign-in or payment popup may START on.
const POPUP_HOSTS = [
  'accounts.google.com',
  'strykertrades-e0cd8.firebaseapp.com',
  'checkout.razorpay.com',
  'api.razorpay.com'
];

// Broker sign-in pages the site itself sends members to (assets/byo-oauth.js, byo-ctrader.js, byo-ui.js).
const OAUTH_HOSTS = [
  'app.alpaca.markets',
  'my.tastytrade.com',
  'id.ctrader.com',
  'api.upstox.com',
  'api-t1.fyers.in',
  'api.schwabapi.com'
];

function parse(url) {
  try { return new URL(url); } catch (e) { return null; }
}

function isAppUrl(url) {
  const u = parse(url);
  return !!u && u.protocol === 'https:' && !u.username && !u.password && !u.port && APP_HOSTS.includes(u.hostname);
}

function classify(url) {
  if (url === 'about:blank') return 'popup';                // window.open('') then set location (journal sync)
  const u = parse(url);
  if (!u) return 'block';
  if (u.protocol === 'mailto:') return 'external';
  if (u.protocol === 'http:') return 'external';           // never load plain http in the app
  if (u.protocol !== 'https:') return 'block';
  if (u.username || u.password) return 'block';             // https://tradezoro.com@evil.example tricks
  if (isAppUrl(url)) {
    // Firebase's sign-in popup on our own auth domain (functions/_auth-proxy.js serves /__/auth/*).
    return u.pathname.startsWith('/__/auth/') ? 'popup' : 'app';
  }
  if (u.port) return 'external';
  if (POPUP_HOSTS.includes(u.hostname)) return 'popup';
  if (OAUTH_HOSTS.includes(u.hostname)) return 'oauth';
  return 'external';
}

// May the MAIN / chart window itself navigate to this URL? (will-navigate, will-redirect)
function mayNavigateAppWindow(url) {
  const c = classify(url);
  return c === 'app' || c === 'oauth' || (c === 'popup' && parse(url).hostname === 'strykertrades-e0cd8.firebaseapp.com');
}

// Inside a sign-in / payment popup the flow may hop through other https hosts (Google Workspace SSO,
// a bank's 3-D Secure page). The popup is sandboxed with no preload, so any https page is allowed there.
function mayNavigatePopup(url) {
  const u = parse(url);
  return !!u && u.protocol === 'https:' && !u.username && !u.password;
}

// Futures week, US Eastern time: Sunday 18:00 to Friday 17:00. Inside it we never pop a restart dialog
// over a trader's charts; the update installs when they quit, or they pick "Restart to update" themselves.
function isMarketHours(date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', weekday: 'short', hour: 'numeric', minute: 'numeric', hourCycle: 'h23'
  }).formatToParts(date || new Date());
  const get = (t) => parts.find((p) => p.type === t).value;
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'));
  const mins = Number(get('hour')) * 60 + Number(get('minute'));
  if (day >= 1 && day <= 4) return true;
  if (day === 0) return mins >= 18 * 60;
  if (day === 5) return mins < 17 * 60;
  return false;
}

module.exports = { APP_HOSTS, POPUP_HOSTS, OAUTH_HOSTS, classify, isAppUrl, mayNavigateAppWindow, mayNavigatePopup, isMarketHours };
