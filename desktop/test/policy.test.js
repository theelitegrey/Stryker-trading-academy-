// node --test test/   (no Electron needed)
const test = require('node:test');
const assert = require('node:assert');
const P = require('../src/policy');

test('TradeZoro pages load in the app', () => {
  for (const u of ['https://tradezoro.com/dashboard-user.html', 'https://tradezoro.com/charts?layout=abc',
    'https://www.tradezoro.com/', 'https://tradezoro.com/login']) assert.strictEqual(P.classify(u), 'app', u);
});

test('look-alike and unsafe TradeZoro URLs are not app pages', () => {
  assert.strictEqual(P.classify('http://tradezoro.com/'), 'external');
  assert.strictEqual(P.classify('https://tradezoro.com.evil.example/'), 'external');
  assert.strictEqual(P.classify('https://eviltradezoro.com/'), 'external');
  assert.strictEqual(P.classify('https://tradezoro.com@evil.example/'), 'block');
  assert.strictEqual(P.classify('https://evil.example/?u=https://tradezoro.com'), 'external');
  assert.strictEqual(P.classify('https://tradezoro.com:8443/'), 'external');
  assert.strictEqual(P.isAppUrl('https://user:pw@tradezoro.com/'), false);
});

test('sign-in and payment popups stay in the app', () => {
  assert.strictEqual(P.classify('https://tradezoro.com/__/auth/handler?apiKey=x'), 'popup');
  assert.strictEqual(P.classify('https://strykertrades-e0cd8.firebaseapp.com/__/auth/handler'), 'popup');
  assert.strictEqual(P.classify('https://accounts.google.com/o/oauth2/auth?x=1'), 'popup');
  assert.strictEqual(P.classify('https://api.razorpay.com/v1/payments'), 'popup');
  assert.strictEqual(P.classify('https://google.com/'), 'external');
  assert.strictEqual(P.classify('about:blank'), 'popup');
  assert.ok(!P.mayNavigateAppWindow('about:blank'));
});

test('broker sign-in pages stay in the app window, other sites go to the browser', () => {
  assert.strictEqual(P.classify('https://id.ctrader.com/my/settings/openapi/grantingaccess/?a=1'), 'oauth');
  assert.strictEqual(P.classify('https://app.alpaca.markets/oauth/authorize'), 'oauth');
  assert.ok(P.mayNavigateAppWindow('https://my.tastytrade.com/auth.html'));
  assert.ok(P.mayNavigateAppWindow('https://tradezoro.com/connect/ctrader/callback?code=1'));
  for (const u of ['https://discord.gg/M4d4gTr5c3', 'https://github.com/theelitegrey', 'https://www.tradingview.com/',
    'mailto:support@tradezoro.com']) {
    assert.strictEqual(P.classify(u), 'external', u);
    assert.ok(!P.mayNavigateAppWindow(u), u);
  }
});

test('non-web schemes are blocked', () => {
  for (const u of ['file:///C:/Windows/system32/calc.exe', 'javascript:alert(1)', 'data:text/html,hi',
    'ms-msdt:/id', 'search-ms:query=x', 'not a url', '']) assert.strictEqual(P.classify(u), 'block', u);
  assert.ok(!P.mayNavigateAppWindow('file:///etc/passwd'));
  assert.ok(!P.mayNavigatePopup('file:///etc/passwd'));
  assert.ok(!P.mayNavigatePopup('http://bank.example/3ds'));
  assert.ok(P.mayNavigatePopup('https://bank.example/3ds'));
});

test('market hours = futures week in New York time', () => {
  assert.strictEqual(P.isMarketHours(new Date('2026-11-16T15:00:00Z')), true);   // Mon 10:00 ET
  assert.strictEqual(P.isMarketHours(new Date('2026-11-14T15:00:00Z')), false);  // Sat
  assert.strictEqual(P.isMarketHours(new Date('2026-11-15T22:00:00Z')), false);  // Sun 17:00 ET
  assert.strictEqual(P.isMarketHours(new Date('2026-11-15T23:30:00Z')), true);   // Sun 18:30 ET
  assert.strictEqual(P.isMarketHours(new Date('2026-11-20T21:30:00Z')), true);   // Fri 16:30 ET
  assert.strictEqual(P.isMarketHours(new Date('2026-11-20T22:30:00Z')), false);  // Fri 17:30 ET
});
