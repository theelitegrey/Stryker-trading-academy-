# Zoro for Vest (v1.0.0, private test build)

A small TradeZoro panel that runs inside Vest's own trade page (next.vestmarkets.com). It gives you a points-based
order panel, copying from one of your Vest accounts to your other Vest accounts, and TradeZoro levels on Vest's chart.

Not published anywhere. Not affiliated with Vest. Education only. Not financial advice.

## How it works (in one paragraph)

The panel runs in the Vest tab you are already signed in to. When Vest's own page reads your accounts, the panel picks up
the same sign-in that Vest uses, and sends your orders to Vest exactly the way Vest's own order form does (same endpoints,
same per-account sign-in). Your Vest sign-in and keys stay in this tab: the panel stores nothing about them, and sends
nothing to TradeZoro. The only thing that goes to tradezoro.com is the levels request, and only if you saved your own
private levels link. There is no version ping and no analytics.

## Install

### Chrome or Edge (extension)

1. Unzip `zoro-for-vest-chrome-1.0.0.zip` into a folder you keep (do not delete it afterwards).
2. Open `chrome://extensions` (Edge: `edge://extensions`), switch on **Developer mode**.
3. Click **Load unpacked** and pick the unzipped folder.
4. Open https://next.vestmarkets.com/trade and sign in to Vest. The TradeZoro panel appears at the bottom left of the chart.

Permissions it asks for: `next.vestmarkets.com` (to run in Vest's page), `tradezoro.com/api/lv/*` (your levels), and
`storage` (to keep your levels link). Nothing else. Needs Chrome/Edge 111 or newer.

### Tampermonkey (any browser with Tampermonkey)

1. Install Tampermonkey.
2. Open the Tampermonkey dashboard, **Utilities**, **Import from file**, pick `zoro-for-vest.user.js`
   (or create a new script and paste the file in, then save).
3. Allow the connection to `tradezoro.com` when Tampermonkey asks (only used for levels).
4. Open https://next.vestmarkets.com/trade and sign in.

Use one or the other, not both at once.

## First run

The panel shows **Before you start**: real orders on real accounts, copies can be late or fail, you are responsible,
education only, TradeZoro is not affiliated with Vest, follow Vest's terms including country restrictions. Tick the box and
click **I agree**. Nothing can be sent before that.

## The panel, button by button

Header
- **TradeZoro logo / dot**: green = ready, teal = copy is on, red = trading is off (the reason is in the line below).
- **Gear**: Settings (limits, theme, read the terms again).
- **Minus**: shrinks the panel to a small pill. Click the pill to open it again.
- Drag the header to move the panel (desktop). It remembers the place.
- Status line: your master account and whether copy is on, or why trading is off.

Trade tab
- **Market / Mark price**: the market open in Vest's page and Vest's mark price.
- **Market / Limit**: the order type. Limit needs a price on the market's tick.
- **Size in: Contracts / $ risk**: type the size, or the dollars you want to risk; $ risk needs a stop and works out the size
  as risk divided by stop points (rounded down to the size step).
- **Stop (pts), Target 1 (pts), Target 2 (pts)**: distances in points from the entry (limit price, or the mark price for a
  market order). Leave empty for none. The line under them shows the prices for long and short, the size and the dollar risk.
  Two targets split the size in half.
- **Buy / Sell**: one-tap bracket: the entry with its stop and targets in one order on Vest.
  If you already hold the market on that side, the order adds to the position and the bracket is not added (Vest keeps one
  stop and target set per position). On the other side it only reduces or closes, it never flips.
- **Breakeven**: moves the stop to each account's own entry price on this market.
- **Close all**: market-closes every open position (master, and followers if copy is on).
- **Cancel all**: cancels every open entry order (stops and targets stay).
- **Confirm each order**: on by default. Shows a summary with each account's size before anything is sent. You can turn
  it off; it comes back on the next visit.

Copy tab
- **Copy (switch)**: the kill switch. OFF on every page load. Turn it off and nothing more is copied at once.
- **Master account**: the account you trade on. Followers copy it.
- **Followers**: switch on the accounts that copy (limit in Settings, default 3). A follower that errors drops out, turns red
  with the reason, and is left out until you click **Retry**.
- **Follower size**: **Same as master (1:1)** or **Scaled to balance** (master size × follower balance / master balance,
  rounded down; a size that rounds to 0 is skipped and logged).
- **Copy Vest's own form too**: also copies what you do on the master in Vest's own order form, chart and tables
  (entries, stop and target moves, cancels, closes). Off = only orders from this panel are copied.

Levels tab
- **Show on Vest's chart**: draws TradeZoro levels as dashed lines on Vest's chart: GEX levels (call ceiling, flip line,
  put floor, pin strike), Zoro Range, Zoro Levels and big dark pool prints. "updated X min ago" shows the age.
- Markets: SPX (SPX levels), SPY, QQQ, and NDX (QQQ levels moved to the NDX scale with Vest's two mark prices). Crypto and
  other markets have no levels yet; the panel says so and draws nothing.
- **Your private levels link (Pro)**: paste the link from tradezoro.com/platform-levels and click **Save**. It is kept in the
  extension's (or Tampermonkey's) own storage, not in Vest's page. Save an empty box to remove it. Without a link the tab
  shows a short Pro note.

Log tab
- Every order, copy, skip and error, per account, with the time. **Clear log** empties it. The log is not saved.

Settings (gear)
- **Max value per order ($)**: default 5,000; can't go above 250,000. Each account's order is checked.
- **Max followers**: default 3; can't go above 10.
- **Max order requests per minute (all accounts)**: default 20; can't go above 60. An order that would go over is refused
  before anything is sent.
- **Theme**: Match Vest, Dark, Light.

## Safety built in

- Nothing trades by itself. Every order starts from your click (in this panel, or in Vest's form on the master when
  "Copy Vest's own form too" is on).
- Master first: followers are only sent after Vest accepts the master's order. If the master is refused, nothing is copied.
- Change check: on each Vest release the panel checks that Vest's page still uses every endpoint it relies on, and checks
  the shape of every Vest answer. If anything changed, trading turns off with the reason, rather than guessing.
- Hard limits above can't be raised from the page.

## For developers

- Source: `src/` (core.js = maths, engine.js = Vest session + orders + copy, levels.js, ui.js + panel.css, boot.js;
  `chrome/` and `userscript/` are the two thin hosts). Build: `python3 extensions/vest/build.py` -> `dist/`.
- Tests: `node tools/tests/vest-ext.test.mjs` (maths + engine against a fake gateway; also in `tools/check.py`);
  `python3 extensions/vest/build.py && flock /tmp/stryker-chrome.lock node tools/tests/vest-ext-browser.js [--shots]`
  (mocked Vest page; fixtures in `test/fixtures/` captured from Vest's public site and our levels feed).
- No eval, no remote code; the panel lives in a closed shadow root; only `window.__zoroForVest = { version }` is visible to the page.
- `extensions/` is excluded from the site deploy.
