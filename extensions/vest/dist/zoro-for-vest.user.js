// ==UserScript==
// @name         Zoro for Vest
// @namespace    https://tradezoro.com/
// @version      1.0.0
// @description  TradeZoro order panel, multi-account copy and levels on Vest. Not affiliated with Vest.
// @match        https://next.vestmarkets.com/*
// @run-at       document-start
// @inject-into  page
// @noframes
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @connect      tradezoro.com
// ==/UserScript==
// Zoro for Vest 1.0.0 (TradeZoro). Built from extensions/vest/src. Education only. Not financial advice.
(function (globalThis) {
globalThis.ZV_ASSETS = {"css": "/* Zoro for Vest panel. Lives in a closed shadow root so Vest's styles and ours never mix. TradeZoro tokens (docs/DESIGN-STANDARD.md). */\n:host { all: initial; }\n.zv {\n  --bg: #0b0b0d; --raised: #131316; --raised2: #1b1b20; --line: rgba(255,255,255,.08); --line2: rgba(255,255,255,.14);\n  --t1: rgba(255,255,255,.92); --t2: rgba(255,255,255,.64); --t3: rgba(255,255,255,.44);\n  --mint: #03c988; --mint-h: #4fe3ac; --on-mint: #04130d; --teal: #00adb5; --amber: #f5a524; --red: #f0616d;\n  --shadow: 0 12px 32px rgba(0,0,0,.45);\n  font: 400 13px/18px -apple-system, BlinkMacSystemFont, \"SF Pro Text\", \"SF Pro Display\", Roboto, \"Segoe UI\", system-ui, sans-serif;\n  color: var(--t1); -webkit-font-smoothing: antialiased; font-variant-numeric: tabular-nums;\n  position: fixed; z-index: 2147483000; left: 72px; bottom: 48px; width: 320px;\n}\n.zv.light {\n  --bg: #ffffff; --raised: #f5f5f7; --raised2: #ececf0; --line: rgba(0,0,0,.09); --line2: rgba(0,0,0,.16);\n  --t1: #1d1d1f; --t2: rgba(29,29,31,.68); --t3: rgba(29,29,31,.5); --mint: #03c988; --on-mint: #04130d; --amber: #b26a00; --red: #c8343f;\n  --shadow: 0 12px 32px rgba(0,0,0,.14);\n}\n.zv *, .zv *::before, .zv *::after { box-sizing: border-box; }\n.zv button, .zv input, .zv select { font: inherit; color: inherit; }\n.zv :focus-visible { outline: 2px solid var(--mint); outline-offset: 2px; }\n\n/* collapsed pill */\n.pill { display: none; align-items: center; gap: 8px; height: 40px; padding: 0 14px 0 8px; border-radius: 999px; border: 1px solid var(--line2);\n  background: var(--bg); box-shadow: var(--shadow); cursor: pointer; }\n.zv.min .pill { display: inline-flex; }\n.zv.min .card { display: none; }\n.pill .lbl { font-weight: 600; }\n\n.card { background: var(--bg); border: 1px solid var(--line2); border-radius: 16px; box-shadow: var(--shadow); overflow: hidden;\n  display: flex; flex-direction: column; max-height: min(640px, calc(100vh - 96px)); }\n.hd { display: flex; align-items: center; gap: 8px; height: 48px; padding: 0 8px 0 12px; border-bottom: 1px solid var(--line); cursor: grab; user-select: none; flex: none; }\n.logo { width: 24px; height: 24px; border-radius: 6px; flex: none; display: block; }\n.ttl { font-weight: 600; font-size: 15px; line-height: 20px; white-space: nowrap; }\n.ttl small { font-weight: 400; font-size: 12px; color: var(--t3); margin-left: 4px; }\n.dot { width: 8px; height: 8px; border-radius: 50%; background: var(--t3); flex: none; }\n.dot.ok { background: var(--mint); } .dot.off { background: var(--red); } .dot.copy { background: var(--teal); }\n.sp { flex: 1; }\n.icon { width: 32px; height: 32px; border-radius: 8px; border: 0; background: transparent; color: var(--t2); display: inline-flex; align-items: center; justify-content: center; cursor: pointer; }\n.icon:hover { background: var(--raised); color: var(--t1); }\n.icon svg { width: 20px; height: 20px; stroke: currentColor; fill: none; stroke-width: 1.75; stroke-linecap: round; stroke-linejoin: round; }\n\n.status { padding: 8px 12px; font-size: 12px; line-height: 16px; color: var(--t2); border-bottom: 1px solid var(--line); flex: none; }\n.status.off { color: var(--red); }\n.status b { font-weight: 600; color: var(--t1); }\n\n.tabs { display: flex; gap: 4px; padding: 8px 12px 0; flex: none; }\n.seg { display: flex; padding: 2px; border-radius: 10px; background: var(--raised); gap: 2px; }\n.seg button { flex: 1; height: 28px; border: 0; border-radius: 8px; background: transparent; color: var(--t2); cursor: pointer; font-size: 12px; font-weight: 500; white-space: nowrap; padding: 0 8px; }\n.seg button[aria-pressed=\"true\"] { background: var(--raised2); color: var(--t1); box-shadow: 0 1px 2px rgba(0,0,0,.2); }\n.tabs .seg { width: 100%; }\n\n.body { overflow-y: auto; overflow-x: hidden; padding: 12px; display: flex; flex-direction: column; gap: 12px; overscroll-behavior: contain; }\n.body::-webkit-scrollbar { width: 10px; }\n.body::-webkit-scrollbar-track { background: transparent; }\n.body::-webkit-scrollbar-button { display: none; }\n.body::-webkit-scrollbar-thumb { background: rgba(160,174,200,.26); border-radius: 999px; border: 2px solid transparent; background-clip: padding-box; }\n.body::-webkit-scrollbar-thumb:hover { background-color: rgba(3,201,136,.62); }\n.light .body::-webkit-scrollbar-thumb { background-color: rgba(20,30,50,.22); }\n.log::-webkit-scrollbar { width: 10px; } .log::-webkit-scrollbar-button { display: none; }\n.log::-webkit-scrollbar-thumb { background: rgba(160,174,200,.26); border-radius: 999px; border: 2px solid transparent; background-clip: padding-box; }\n\n.row { display: flex; gap: 8px; align-items: flex-end; }\n.row > * { flex: 1; min-width: 0; }\n.fld { display: flex; flex-direction: column; gap: 4px; }\n.fld > span { font-size: 12px; line-height: 16px; color: var(--t2); font-weight: 500; }\n.in { height: 36px; width: 100%; padding: 0 10px; border-radius: 8px; border: 1px solid var(--line2); background: var(--raised); color: var(--t1); outline: none; }\n.in:focus { border-color: var(--mint); }\n.in::placeholder { color: var(--t3); }\nselect.in { appearance: none; -webkit-appearance: none; padding-right: 28px; background-image: linear-gradient(45deg, transparent 50%, currentColor 50%), linear-gradient(135deg, currentColor 50%, transparent 50%);\n  background-position: calc(100% - 15px) 16px, calc(100% - 10px) 16px; background-size: 5px 5px; background-repeat: no-repeat; }\n.hint { font-size: 12px; line-height: 16px; color: var(--t3); margin: 0; }\n.hint.warn { color: var(--amber); } .hint.err { color: var(--red); }\n\n.btn { height: 40px; border-radius: 12px; border: 1px solid var(--line2); background: var(--raised); color: var(--t1); font-weight: 600; cursor: pointer; padding: 0 12px; white-space: nowrap; }\n.btn:hover { background: var(--raised2); }\n.btn.pri { background: var(--mint); border-color: var(--mint); color: var(--on-mint); }\n.btn.pri:hover { background: var(--mint-h); }\n.btn.sm { height: 32px; border-radius: 8px; font-size: 12px; font-weight: 500; }\n.btn[disabled] { opacity: .45; cursor: not-allowed; }\n.btn.sell { color: var(--t1); }\n.btns { display: flex; gap: 8px; } .btns > * { flex: 1; }\n\n.list { border: 1px solid var(--line); border-radius: 12px; overflow: hidden; }\n.li { display: flex; align-items: center; gap: 8px; min-height: 48px; padding: 6px 12px; border-top: 1px solid var(--line); }\n.li:first-child { border-top: 0; }\n.li .t { flex: 1; min-width: 0; }\n.li .t b { display: block; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }\n.li .t i { display: block; font-style: normal; font-size: 12px; line-height: 16px; color: var(--t3); }\n.li .t i.err { color: var(--red); }\n.sw { position: relative; width: 40px; height: 24px; flex: none; }\n.sw input { position: absolute; inset: 0; opacity: 0; margin: 0; cursor: pointer; }\n.sw span { position: absolute; inset: 0; border-radius: 999px; background: var(--raised2); border: 1px solid var(--line2); transition: background .2s cubic-bezier(.2,0,0,1); pointer-events: none; }\n.sw span::after { content: \"\"; position: absolute; top: 2px; left: 2px; width: 18px; height: 18px; border-radius: 50%; background: var(--t2); transition: transform .2s cubic-bezier(.2,0,0,1); }\n.sw input:checked + span { background: var(--mint); border-color: var(--mint); }\n.sw input:checked + span::after { transform: translateX(16px); background: #fff; }\n.sw input:focus-visible + span { outline: 2px solid var(--mint); outline-offset: 2px; }\n\n.kill { display: flex; align-items: center; gap: 12px; padding: 12px; border-radius: 12px; border: 1px solid var(--line2); background: var(--raised); }\n.kill.on { border-color: var(--teal); }\n.kill .t { flex: 1; } .kill .t b { display: block; font-weight: 600; } .kill .t i { font-style: normal; font-size: 12px; color: var(--t3); }\n\n.log { max-height: 280px; overflow-y: auto; display: flex; flex-direction: column; gap: 0; border: 1px solid var(--line); border-radius: 12px; }\n.lg { padding: 8px 12px; border-top: 1px solid var(--line); font-size: 12px; line-height: 16px; }\n.lg:first-child { border-top: 0; }\n.lg .m { color: var(--t3); } .lg.error .x { color: var(--red); } .lg.warn .x { color: var(--amber); }\n.empty { color: var(--t3); font-size: 12px; text-align: center; padding: 16px; }\n\n.banner { padding: 8px 12px; border-radius: 8px; font-size: 12px; line-height: 16px; background: var(--raised); border: 1px solid var(--line); }\n.banner.warn { color: var(--amber); }\n\n/* confirm + terms sheet over the panel */\n.sheet { position: absolute; inset: 0; background: var(--bg); border-radius: 16px; display: flex; flex-direction: column; z-index: 2; }\n.sheet .body { flex: 1; }\n.sheet h3 { margin: 0; font-size: 15px; line-height: 20px; font-weight: 600; }\n.sheet p, .sheet li { margin: 0; color: var(--t2); }\n.sheet ul { margin: 0; padding-left: 18px; display: flex; flex-direction: column; gap: 8px; }\n.sheet .foot { padding: 12px; border-top: 1px solid var(--line); display: flex; flex-direction: column; gap: 8px; flex: none; }\n.chk { display: flex; gap: 8px; align-items: flex-start; font-size: 12px; line-height: 16px; color: var(--t2); cursor: pointer; }\n.chk input { margin: 1px 0 0; width: 16px; height: 16px; accent-color: var(--mint); flex: none; }\n.sum { display: grid; grid-template-columns: auto 1fr; gap: 4px 12px; font-size: 13px; }\n.sum dt { color: var(--t3); } .sum dd { margin: 0; text-align: right; }\n.a { color: var(--mint); text-decoration: none; font-weight: 500; }\n.a:hover { text-decoration: underline; }\n[hidden] { display: none !important; }\n\n/* phone: a bottom sheet with a grabber, controls at 44 */\n@media (max-width: 600px) {\n  .zv { left: 12px; right: 12px; bottom: 76px; width: auto; }\n  .zv.min { right: auto; }\n  .card { max-height: 70vh; border-radius: 20px 20px 16px 16px; }\n  .hd { cursor: default; }\n  .hd::before { content: \"\"; position: absolute; left: 50%; margin-left: -18px; top: 6px; width: 36px; height: 4px; border-radius: 2px; background: var(--line2); }\n  .card { position: relative; }\n}\n@media (pointer: coarse) {\n  .in { height: 44px; font-size: 16px; }\n  .btn { height: 44px; } .btn.sm { height: 40px; }\n  .seg button { height: 36px; }\n  .icon { width: 44px; height: 44px; }\n}\n@media (prefers-reduced-motion: reduce) { .sw span, .sw span::after { transition: none; } }\n", "logo": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAYAAABXAvmHAAAH1ElEQVR42u2YXYxdVRXHf2vtfT7umY9+Ay0g0GA0bYSYlvjgQ8UHNBpFINMQjAECagIhSkhDNJrbSSQ+2AdBJSoarSJix0SIgAIx5SPB+oBBBFSiRCTQYontzLQz995z9lo+nBkspYVOKdHE+Scn92afvc/+/9fH3mtvWMQiFrGIRSxiEf89yFHbu115W2bcetwDHRH///DAGd3Ll1pTrAhl03iTvdrHGShliYfYthXgIYr5QCkK0NC2D1VOk4QCyHP6TRIs+WBqmuzs1crKjpDnDOY/nOf0JYkMBR/USchz8OBIEHqeyMqK2f4ezrjsJdzlUE/E1zDfMRbYPJEkhU8Hta12IPVcUnDAQUQRtx4EEVeBvgqqYgGh75DF9p2ZoyI+AJc+boa7E5cN4476dC1eGMSARcE8QQySZtxVAwwQgjqGURY5xvMW4odxf53B4xH9ErRAtfKeVa7CvFxzAXPcHYLgOu9Hwc2hSYDidYIoGGB1g0eFlSMwWuJmWEpYM/ceJaGYJFy1DQoN0ODkueD6iqVwIadd8he8q8i4vbmAqIiqk4UkQniVpEBrA2HeFi6ASisozvVJDd44qTHoZMiKYbyT4e6Y0BJ3xzEamDNsAFfwIJgYeSZomLap5kLOvPhJfEdANqdj80CMoJIkj+YgSCtA5jLBVUJLWiG2brA6ufVrsya1ojKFkQ4srfCoWDsOE8dAzF2T03rXBfcwL8KIOcSill6zmTPHHmNnNyKbmyNSPVKjFrEKw51IFnA9xNrMWa+u8WRYnUjTs1hvgAcVGSoCeUQ6OSzpwGgHLyNeZngRsahYHjAgYXgeIWZ4lkHMIGZOUQgSxfrN5ay55Nf4zoic3xxtFXqtgLEdBoJ3wl2uvEyR1eKmFoAEFsVpvBrsnvpi6tVLvW7c3Z0iU1d9JOR6u+ehpMqEIopHVSJqmZJwMTx6FqabV6Y28tL+KzAcCSKqoMHR4KD4madcwXmfubO1/NHJv9FG9oZjll039neivqNlT5JOEQ3/+tRXb7/+TUdfe+kaPbXzgNS2jsYd1Ta+ZmtjZhB87/4rbeLBH7KzGzl/vHmzzx05B7pd3QT68Pr1ztNPtyJ37xZWr/bh6WeXukpspbcZ4lmAwAjdTRFOUlj3n5Vi/Xpn96ORz32jz49vWBdenr4f5zQ8OUVQZmuYmjWSBYfrFkJ+YR5wBMFHu1ctD039FCqr3d1dxajy4ML3p2687WrGxgITE+nwvYUfXX922HvwARo7i0SiscD+WTjQa8iz6O5fsm9N3ER3U2T84eZYacXj2r/LrF063UAVOjkWRF/Xb5789hvfEfbuu4/kZ1FbYqYOTM5AbQ1DnUiybXbLnTcxNhYYn2gWQkUXTH4U6GRCleNVQfub4+WcLcYOI3/HljVhcupXoO9kpklM9gIH+xCzhhVLIjH8IN1y55Y5z9lC6SzAAw4INrxEgydFBNzxoPhIOb+lzXXtKjKeuOMLJ+vM7H2IrmP6YKKfAjFCljV0yujud9uXv3M11VplfNzmJnm7BMxh9QhMzooHBbN25x0usHlvrl2myHjNzm0r9aV/3iONn8tUryGEyHAGRqJTRkcetvec/klEHHcYHz+uUnnhAuJAGCqEoLgbFgQfLh1P3ib6d2uev3WZ7nrhHplpNnKg19ApI6JgniiK4KJP2KpTLuZDNxyk21VEjOPEggX4kuXieV9cpK1nVN2XlNKkNILg7Lp5VHf9424Z2Puom4bR4QhCW1mWwU3+Znn+CcZu2MeObg7rE91uy2Pr+kO8MHbotHa0w8wCltG2Dh964taT4szBZyzIiuRuFhQbyj0JH037Bo/onn33isv5zNYNGiIo7hgxEzqdp2zDuz7IqR9/5e0+Uh5dwJO3nSw+84yLLE/Q2LJObOr6Clt7zXZ98Cv3C+ECDg4akOhom9shOo2J/+mFX8hk7w8+OrSEsjCqjpKXQlUJVaXeqYSihDwX0UI8xsTSlSVN+g3v3vAz3F8XbgsPoZEonnLcMFs5FJveYIudfs12fexr94rEC3yy11CVEbSt/LIceo3IY08jjV3E8tGLKEoYqqDqQKeCqsKrCikryAvISgg5VEMwWydUvnnikrgC68eUVi/VZvLANl9z9TZ94pa7JGQf8clew3A1F/MCWQb9hPz2Keg3MFKZI4ZIuwVJaA9ABjTAIIE3YDUeQ6KQDPNLWbfxSXbsCIiktyxgJlmKI8UqPzB7u6+8ckv487dv9xgv9P29AWUZQQyTtjyuHXno93BgFkaH8bKAstTW6h0oO3ingqKErIDYPh7yxLIVBVMz2znnvJ/jfkTyx+mBMOrOT9OL5VXy3Pd+4ktGLmPvNIwO50hoLa8RBoY8sAsO1rBqBZ5n0Om0TzUXNp0hKDtt2MQC8hLXCMOjykz/r6Twedx17hjyFkNofhmb1T3p0V9+ivd/7FqRcpNPzv6RPFcxVUddVJQQnZ2/m/Y9/4JVy9WLTCgKpSyFsnSKAmKmxExQDUgQUHUXAxVqS7hey3vP3T+XuH4izwMtnr15lBfPmeEDIwKPAxvg8cehXCb09jkbP9vgDmyV9jZrQtq1faId/9Cqdu6RZwU2QPmc0FvrlKUwMWGMjzeHX6GcOPgxCH+r93pHuEI50dPIG5ZecszGOPzPa0N2EYtYxCIWsYhF/A/j31berB+6r59HAAAAAElFTkSuQmCC"};

// ---- core.js
// Zoro for Vest: pure logic (no DOM, no network). Sizing, points -> price, brackets, copy fan-out, rate limiter,
// change detection (response shapes), settings caps, levels link parsing. Loaded in the page bundle and by the unit tests.
// Education only. Not financial advice.
(function (root) {
  'use strict';

  // ---- hard limits (the member can lower these, never raise them) -------------------------------------------------------------------
  var HARD = { maxNotionalUsd: 250000, maxFollowers: 10, maxOrdersPerMin: 60 };
  var DEFAULTS = {
    maxNotionalUsd: 5000, maxFollowers: 3, maxOrdersPerMin: 20, sizing: 'equal', mirrorVestForm: true,
    master: null, followers: [], theme: 'auto', showLevels: true, panelX: null, panelY: null,
  };
  var TERMS_VERSION = 1;

  function num(x) { var n = typeof x === 'string' ? Number(x.trim()) : x; return typeof n === 'number' && isFinite(n) ? n : NaN; }
  function intIn(x, lo, hi, dflt) { var n = Math.floor(num(x)); return isFinite(n) && n >= lo ? Math.min(n, hi) : dflt; }

  function clampSettings(s) {
    s = s && typeof s === 'object' ? s : {};
    var o = {};
    o.maxNotionalUsd = intIn(s.maxNotionalUsd, 1, HARD.maxNotionalUsd, DEFAULTS.maxNotionalUsd);
    o.maxFollowers = intIn(s.maxFollowers, 0, HARD.maxFollowers, DEFAULTS.maxFollowers);
    o.maxOrdersPerMin = intIn(s.maxOrdersPerMin, 1, HARD.maxOrdersPerMin, DEFAULTS.maxOrdersPerMin);
    o.sizing = s.sizing === 'balance' ? 'balance' : 'equal';
    o.mirrorVestForm = s.mirrorVestForm !== false;
    o.master = typeof s.master === 'string' && s.master.length < 100 ? s.master : null;
    o.followers = Array.isArray(s.followers) ? s.followers.filter(function (f) { return typeof f === 'string' && f.length < 100 && f !== o.master; }).slice(0, HARD.maxFollowers) : [];
    o.theme = ['dark', 'light'].indexOf(s.theme) >= 0 ? s.theme : 'auto';
    o.showLevels = s.showLevels !== false;
    o.panelX = isFinite(num(s.panelX)) ? num(s.panelX) : null;
    o.panelY = isFinite(num(s.panelY)) ? num(s.panelY) : null;
    return o;
  }

  // ---- decimals: work in integer units so 0.1 + 0.2 never leaks into an order ---------------------------------------------------------
  function pow10(d) { return Math.pow(10, d); }
  function toUnits(x, dec) { return Math.round(num(x) * pow10(dec)); }
  function fromUnits(u, dec) {
    var neg = u < 0, s = String(Math.abs(u));
    if (dec === 0) return (neg ? '-' : '') + s;
    while (s.length <= dec) s = '0' + s;
    var a = s.slice(0, s.length - dec), b = s.slice(s.length - dec).replace(/0+$/, '');
    return (neg ? '-' : '') + (b ? a + '.' + b : a);
  }
  function decimalsOf(step) { var s = String(step); if (/e-/i.test(s)) return Number(s.split(/e-/i)[1]); var i = s.indexOf('.'); return i < 0 ? 0 : s.length - i - 1; }

  // price rounded to the market's tick. mode: 'near' | 'down' | 'up'
  function roundToTick(price, tick, priceDecimals, mode) {
    var d = Math.max(priceDecimals, decimalsOf(tick));
    var p = toUnits(price, d), t = toUnits(tick, d);
    if (!(t > 0) || !isFinite(p)) return null;
    var q = mode === 'down' ? Math.floor(p / t) : mode === 'up' ? Math.ceil(p / t) : Math.round(p / t);
    return fromUnits(q * t, d);
  }

  // size: always rounded DOWN to the size step (never more than asked)
  function floorSize(qty, sizeDecimals) {
    var u = Math.floor(num(qty) * pow10(sizeDecimals) + 1e-7);
    return u > 0 ? fromUnits(u, sizeDecimals) : '0';
  }

  // ---- points from entry -> price ---------------------------------------------------------------------------------------------------
  // kind 'stop': long below entry, short above. kind 'target': the other way. Returns a price string or null when invalid.
  function pointsToPrice(o) {
    var entry = num(o.entry), pts = num(o.points);
    if (!(entry > 0) || !(pts > 0)) return null;
    var below = (o.kind === 'stop') === !!o.isLong;
    var raw = below ? entry - pts : entry + pts;
    if (!(raw > 0)) return null;
    return roundToTick(raw, o.tick, o.priceDecimals, 'near');
  }

  // $ risk -> contracts. Vest perps are linear: 1 contract moves $1 per 1 point. Rounded down to the size step.
  function sizeFromRisk(o) {
    var risk = num(o.riskUsd), pts = num(o.stopPoints);
    if (!(risk > 0) || !(pts > 0)) return '0';
    return floorSize(risk / pts, o.sizeDecimals);
  }

  // Full bracket for one order. targets: [points, points?]. Two targets split the size in half (last leg takes the remainder).
  // -> { stop: price|null, targets: [{ price, qty|null }], riskUsd } or { error }
  function bracket(o) {
    var spec = o.spec, isLong = !!o.isLong;
    var q = toUnits(o.qty, spec.sizeDecimals);
    if (!(q > 0)) return { error: 'Size must be more than 0.' };
    var out = { stop: null, targets: [], riskUsd: null };
    if (num(o.stopPoints) > 0) {
      out.stop = pointsToPrice({ entry: o.entry, points: o.stopPoints, isLong: isLong, kind: 'stop', tick: spec.tick, priceDecimals: spec.priceDecimals });
      if (!out.stop) return { error: 'Stop is beyond zero. Use fewer points.' };
      out.riskUsd = Math.abs(num(o.entry) - num(out.stop)) * num(o.qty);
    }
    var tp = (o.targetPoints || []).map(num).filter(function (x) { return x > 0; });
    if (tp.length > 2) return { error: 'Two targets at most.' };
    var legs = tp.length === 2 ? [Math.floor(q / 2), q - Math.floor(q / 2)] : [q];
    if (tp.length === 2 && legs[0] < 1) return { error: 'Size is too small to split into two targets.' };
    for (var i = 0; i < tp.length; i++) {
      var price = pointsToPrice({ entry: o.entry, points: tp[i], isLong: isLong, kind: 'target', tick: spec.tick, priceDecimals: spec.priceDecimals });
      if (!price) return { error: 'Target ' + (i + 1) + ' is not valid.' };
      out.targets.push({ price: price, qty: tp.length === 2 ? fromUnits(legs[i], spec.sizeDecimals) : null });
    }
    return out;
  }

  // ---- copy sizing --------------------------------------------------------------------------------------------------------------------
  // mode 'equal' = same size as the master (1:1). 'balance' = master size x follower balance / master balance. Rounded down.
  function followerQty(o) {
    var mq = num(o.masterQty);
    if (!(mq > 0)) return '0';
    if (o.mode !== 'balance') return floorSize(mq, o.sizeDecimals);
    var mb = num(o.masterBalance), fb = num(o.followerBalance);
    if (!(mb > 0) || !(fb > 0)) return '0';
    return floorSize(mq * fb / mb, o.sizeDecimals);
  }

  function scaleLegs(legs, ratio, sizeDecimals) {
    return (legs || []).map(function (l) {
      var c = {}; for (var k in l) c[k] = l[k];
      if (l.quantity != null) c.quantity = floorSize(num(l.quantity) * ratio, sizeDecimals);
      return c;
    }).filter(function (l) { return l.quantity == null || num(l.quantity) > 0; });
  }

  // Plan the follower copies of one master action.
  // action: { kind, symbol, qty (master size, string|null), body }   accounts: [{ id, balance, enabled }]
  // -> [{ accountId, qty, ratio, skip: reason|null }] in follower order; followers past maxFollowers are skipped.
  function planFanout(action, followers, o) {
    var out = [], used = 0;
    (followers || []).forEach(function (f) {
      if (!f.enabled) return;
      if (used >= o.maxFollowers) { out.push({ accountId: f.id, skip: 'Over the follower limit (' + o.maxFollowers + ').' }); return; }
      used++;
      if (action.qty == null) { out.push({ accountId: f.id, qty: null, ratio: 1, skip: null }); return; }
      var q = followerQty({ masterQty: action.qty, mode: o.sizing, masterBalance: o.masterBalance, followerBalance: f.balance, sizeDecimals: o.sizeDecimals });
      var ratio = num(q) / num(action.qty);
      out.push({ accountId: f.id, qty: q, ratio: ratio, skip: num(q) > 0 ? null : 'Size rounds to 0 for this account.' });
    });
    return out;
  }

  // ---- order checks before anything is sent ---------------------------------------------------------------------------------------------
  function checkOrder(o) {
    var q = num(o.qty), px = num(o.price);
    if (!(q > 0)) return 'Size must be more than 0.';
    if (toUnits(q, o.spec.sizeDecimals) / pow10(o.spec.sizeDecimals) !== q) return 'Size has too many decimals for this market.';
    if (!(px > 0)) return 'No price for this market right now.';
    if (q * px > o.maxNotionalUsd) return 'Order value $' + Math.round(q * px).toLocaleString('en-US') + ' is over your limit of $' + o.maxNotionalUsd.toLocaleString('en-US') + '.';
    return null;
  }

  // ---- rate limiter: sliding 60 s window over every order request sent (all accounts together) -----------------------------------------
  function RateLimiter(perMin, now) {
    this.perMin = perMin; this.now = now || Date.now; this.t = [];
  }
  RateLimiter.prototype.prune = function () { var c = this.now() - 60000; while (this.t.length && this.t[0] <= c) this.t.shift(); };
  RateLimiter.prototype.room = function () { this.prune(); return Math.max(0, this.perMin - this.t.length); };
  RateLimiter.prototype.take = function (n) {
    n = n || 1; this.prune();
    if (this.t.length + n > this.perMin) return false;
    var at = this.now(); for (var i = 0; i < n; i++) this.t.push(at);
    return true;
  };

  // ---- change detection: refuse to trade when Vest's answers no longer look like what this version was built against -------------------
  // schema: { key: 'string'|'number'|'boolean'|'any'|'string?'|[schema]|{...} }. Returns the list of paths that do not match.
  function shapeErrors(v, schema, path) {
    path = path || '$';
    var errs = [];
    if (Array.isArray(schema)) {
      if (!Array.isArray(v)) return [path + ' is not a list'];
      for (var i = 0; i < Math.min(v.length, 5); i++) errs = errs.concat(shapeErrors(v[i], schema[0], path + '[' + i + ']'));
      return errs;
    }
    if (typeof schema === 'object') {
      if (!v || typeof v !== 'object') return [path + ' is missing'];
      for (var k in schema) errs = errs.concat(shapeErrors(v[k], schema[k], path + '.' + k));
      return errs;
    }
    var opt = /\?$/.test(schema), t = schema.replace('?', '');
    if (v === undefined || v === null) return opt ? [] : [path + ' is missing'];
    if (t === 'any') return [];
    if (t === 'numstr') return (typeof v === 'string' || typeof v === 'number') && isFinite(Number(v)) ? [] : [path + ' is not a number'];
    return typeof v === t ? [] : [path + ' is ' + typeof v + ', expected ' + t];
  }

  var LEG = { id: 'string', executionType: 'string', triggerPrice: 'numstr' };
  var SCHEMAS = {
    exchangeInfo: { symbols: [{ symbol: 'string', sizeDecimals: 'number', priceDecimals: 'number', minTickSize: 'numstr', tradingStatus: 'string' }] },
    ticker: { tickers: [{ symbol: 'string', markPrice: 'numstr' }] },
    accounts: { accounts: [{ account_id: 'string', account_type: 'any', amount: 'numstr' }] },
    positions: { positions: [{ positionId: 'string', symbol: 'string', side: 'string', quantity: 'numstr', openPrice: 'numstr', takeProfits: [LEG], stopLosses: [LEG] }] },
    orders: { orders: [{ id: 'string', symbol: 'string', status: 'string' }] },
    accountToken: { accessToken: 'string' },
    orderAck: { commandId: 'any' },
  };
  // the endpoints this version uses; every one must still appear in Vest's own page code, or trading stays off
  var ENDPOINTS = ['/v3/positions/open', '/v3/positions/append', '/v3/positions/reduce', '/v3/positions/close', '/v3/positions/cancel-order',
    '/v3/positions/opened', '/v3/positions/opened-orders', '/v3/auth/account-token', '/v3/accounts', '/v3/exchangeInfo', 'take-profit', 'stop-loss'];
  // quoted, so "/v3/positions/open" is not satisfied by "/v3/positions/opened"
  function missingEndpoints(bundleText) { var t = String(bundleText); return ENDPOINTS.filter(function (e) { return t.indexOf('"' + e + '"') < 0; }); }

  // ---- tokens (read the expiry only; nothing is verified or stored) ----------------------------------------------------------------------
  function jwtPayload(tok) {
    try {
      var p = String(tok).split('.')[1]; if (!p) return null;
      p = p.replace(/-/g, '+').replace(/_/g, '/'); while (p.length % 4) p += '=';
      var s = typeof atob === 'function' ? atob(p) : Buffer.from(p, 'base64').toString('binary');
      var j = JSON.parse(decodeURIComponent(s.split('').map(function (c) { return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2); }).join('')));
      return j && typeof j === 'object' ? j : null;
    } catch (e) { return null; }
  }
  function tokenExpMs(tok, fallbackMs) { var p = jwtPayload(tok); return p && isFinite(p.exp) ? p.exp * 1000 : fallbackMs; }

  // ---- TradeZoro levels ---------------------------------------------------------------------------------------------------------------
  var LEVELS_ORIGIN = 'https://tradezoro.com';
  // Vest's index perps track the cash index (checked against SPY/QQQ marks), not futures, so ES/NQ levels would sit off by the basis.
  // The feed has no NDX: NDX gets the QQQ levels moved to NDX's scale with Vest's own two mark prices (said under the list).
  var LV_MAP = { 'SPX-USD-PERP': 'SPX', 'NDX-USD-PERP': 'QQQ', 'SPY-USD-PERP': 'SPY', 'QQQ-USD-PERP': 'QQQ' };
  var LV_SCALE = { 'NDX-USD-PERP': 'QQQ-USD-PERP' };
  function levelsSymbol(vestSym) { return LV_MAP[vestSym] || null; }
  function levelsScaleFrom(vestSym) { return LV_SCALE[vestSym] || null; }
  // levels moved by ratio of two marks; null when either mark is missing (then nothing is drawn rather than guessed)
  function scaleLevels(levels, ratio, priceDecimals) {
    if (!(ratio > 0) || !isFinite(ratio)) return null;
    var f = Math.pow(10, priceDecimals == null ? 2 : priceDecimals);
    return levels.map(function (l) { return Object.assign({}, l, { price: Math.round(l.price * ratio * f) / f }); });
  }
  // the member pastes the private link from tradezoro.com/platform-levels; only the secret is kept, the host is always ours
  function parseLevelsLink(s) {
    var m = /\/api\/lv\/feed\/([A-Za-z0-9_-]{43})\.[a-z]{2,6}/.exec(String(s || '').trim());
    if (m) return m[1];
    return /^[A-Za-z0-9_-]{43}$/.test(String(s || '').trim()) ? String(s).trim() : null;
  }
  function levelsUrl(secret, u) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(secret) || ['SPX', 'SPY', 'QQQ', 'ES', 'NQ'].indexOf(u) < 0) return null;
    return LEVELS_ORIGIN + '/api/lv/feed/' + secret + '.json?u=' + u + '&inc=gex,em,nodes,dp';
  }
  var LEVELS_SCHEMA = { symbol: 'string', updated: 'string', levels: [{ type: 'string', label: 'string', price: 'number', color: 'string?' }] };
  function minsAgo(iso, now) { var t = Date.parse(iso); if (!isFinite(t)) return null; return Math.max(0, Math.round(((now || Date.now()) - t) / 60000)); }
  function agoText(m) { return m === null ? '' : m < 1 ? 'updated just now' : m < 60 ? 'updated ' + m + ' min ago' : 'updated ' + Math.round(m / 60) + ' h ago'; }

  function shortId(id) { return '…' + String(id || '').slice(-4); }

  var api = {
    HARD: HARD, DEFAULTS: DEFAULTS, TERMS_VERSION: TERMS_VERSION, SCHEMAS: SCHEMAS, ENDPOINTS: ENDPOINTS, LEVELS_SCHEMA: LEVELS_SCHEMA,
    clampSettings: clampSettings, toUnits: toUnits, fromUnits: fromUnits, decimalsOf: decimalsOf, roundToTick: roundToTick, floorSize: floorSize,
    pointsToPrice: pointsToPrice, sizeFromRisk: sizeFromRisk, bracket: bracket, followerQty: followerQty, scaleLegs: scaleLegs,
    planFanout: planFanout, checkOrder: checkOrder, RateLimiter: RateLimiter, shapeErrors: shapeErrors, missingEndpoints: missingEndpoints,
    jwtPayload: jwtPayload, tokenExpMs: tokenExpMs, levelsSymbol: levelsSymbol, levelsScaleFrom: levelsScaleFrom, scaleLevels: scaleLevels, parseLevelsLink: parseLevelsLink, levelsUrl: levelsUrl,
    minsAgo: minsAgo, agoText: agoText, shortId: shortId, num: num,
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ZV_CORE = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

// ---- engine.js
// Zoro for Vest: in-page engine. Runs inside next.vestmarkets.com with the member's own logged-in session.
// - Watches Vest's own calls to its gateway to learn the member's session token (it never leaves this page; nothing is stored).
// - Sends orders the same way Vest's own page does (REST on api-gateway, per-account token minted with the session token).
// - Copies master actions to follower accounts. Every order starts from the member's own action (our panel or Vest's form).
// - Trading switches OFF when Vest's page or answers no longer look like what this version was built for.
// Education only. Not financial advice.
(function (root) {
  'use strict';
  var C = root.ZV_CORE || (typeof require === 'function' ? require('./core.js') : null);
  var GW = 'https://api-gateway.hz.vestmarkets.com';
  var USER_PATHS = { '/v3/accounts': 1, '/v3/positions/opened': 1, '/v3/positions/opened-orders': 1, '/v3/user-state': 1 };
  var WRITE_RE = /^\/v3\/positions\/(open|append|reduce|close|cancel-order|take-profit|stop-loss)$/;
  var ACCT_NAMES = { 1: 'Main', 2: 'Evaluation', 3: 'Funded', 8: 'Demo' };
  var ACCT_OK = { 1: 1, 2: 1, 3: 1, 8: 1 };
  function noop() {}
  function isGw(u) { return typeof u === 'string' && u.indexOf(GW + '/') === 0; }
  function pathOf(u) { try { return new URL(u).pathname; } catch (e) { return ''; } }
  function bearer(a) { var m = /^Bearer\s+(\S+)$/i.exec(String(a || '')); return m ? m[1] : null; }
  function jparse(t) { try { return t ? JSON.parse(t) : null; } catch (e) { return null; } }
  function errText(j, status) {
    var d = j && (j.detail || j);
    var msg = d && (d.msg || d.message || d.error);
    return (msg ? String(msg).slice(0, 160) : 'Vest answered ' + status) + (d && d.code ? ' (code ' + d.code + ')' : '');
  }

  function Engine(win, opts) {
    var self = this;
    opts = opts || {};
    this.win = win;
    this.fetch0 = win.fetch.bind(win);
    this.now = opts.now || Date.now;
    this.settings = C.clampSettings(opts.settings);
    this.userTok = null;                 // { t, exp }
    this.acctTok = {};                   // accountId -> { t, exp }  (memory only)
    this.tokAcct = {};                   // token -> accountId (from Vest's own account-token answers)
    this.accounts = [];                  // [{ id, type, name, balance }]
    this.positions = {};                 // accountId -> [position]
    this.orders = {};                    // accountId -> [order]
    this.lev = {};                       // accountId -> { symbol: leverage }
    this.spec = {};                      // symbol -> { sizeDecimals, priceDecimals, tick, status }
    this.marks = {};                     // symbol -> mark price
    this.orderMap = {};                  // master orderId -> [{ acct, orderId }]
    this.dropped = {};                   // follower id -> reason
    this.copyOn = false;                 // kill switch: OFF on every page load
    this.ok = false; this.offReason = 'Starting…'; this.checked = false;
    this.log = [];
    this.limiter = new C.RateLimiter(this.settings.maxOrdersPerMin, this.now);
    this.listeners = [];
    this.hook();
  }
  var P = Engine.prototype;
  P.on = function (fn) { this.listeners.push(fn); };
  P.emit = function () { var s = this; this.listeners.forEach(function (fn) { try { fn(s); } catch (e) { /* ui error never breaks trading */ } }); };
  P.note = function (acct, text, level) {
    this.log.unshift({ t: this.now(), acct: acct || null, text: text, level: level || 'info' });
    if (this.log.length > 200) this.log.length = 200;
    this.emit();
  };
  P.setSettings = function (s) { this.settings = C.clampSettings(s); this.limiter.perMin = this.settings.maxOrdersPerMin; this.emit(); };
  P.setOff = function (why) { if (this.ok || this.offReason !== why) { this.ok = false; this.offReason = why; this.copyOn = false; this.note(null, 'Trading is off: ' + why, 'error'); } };
  P.acctName = function (id) { var a = this.accounts.filter(function (x) { return x.id === id; })[0]; return (a ? a.name : 'Account') + ' ' + C.shortId(id); };

  // ---- watch Vest's own gateway calls ---------------------------------------------------------------------------------------------------
  P.hook = function () {
    var self = this, win = this.win;
    var XO = win.XMLHttpRequest && win.XMLHttpRequest.prototype;
    if (XO && !XO.__zvHooked) {
      XO.__zvHooked = true;
      var oOpen = XO.open, oSend = XO.send, oSet = XO.setRequestHeader;
      XO.open = function (m, u) { this.__zv = { m: String(m).toUpperCase(), u: String(u) }; return oOpen.apply(this, arguments); };
      XO.setRequestHeader = function (k, v) { if (this.__zv && /^authorization$/i.test(k)) this.__zv.a = String(v); return oSet.apply(this, arguments); };
      XO.send = function (b) {
        var z = this.__zv, x = this;
        if (z && isGw(z.u)) {
          z.b = typeof b === 'string' ? b : null;
          x.addEventListener('loadend', function () {
            var t = null;
            try { t = x.responseType === '' || x.responseType === 'text' ? x.responseText : x.responseType === 'json' ? JSON.stringify(x.response) : null; } catch (e) { t = null; }
            self.seen(z.m, z.u, z.a, z.b, x.status, t);
          });
        }
        return oSend.apply(this, arguments);
      };
    }
    var oFetch = win.fetch;
    if (oFetch && !oFetch.__zv) {
      var wrapped = function (input, init) {
        var p = oFetch.apply(this, arguments);
        try {
          var u = typeof input === 'string' ? input : input && input.url;
          if (isGw(u)) {
            var m = String((init && init.method) || (input && input.method) || 'GET').toUpperCase();
            var h = init && init.headers, a = null;
            if (h) a = typeof h.get === 'function' ? h.get('authorization') : h.Authorization || h.authorization;
            if (!a && input && input.headers && input.headers.get) a = input.headers.get('authorization');
            var b = init && typeof init.body === 'string' ? init.body : null;
            p.then(function (r) { r.clone().text().then(function (t) { self.seen(m, u, a, b, r.status, t); }, noop); }, noop);
          }
        } catch (e) { /* never break Vest's own call */ }
        return p;
      };
      wrapped.__zv = true;
      win.fetch = wrapped;
    }
  };

  P.acctOfToken = function (t) {
    if (!t) return null;
    if (this.tokAcct[t]) return this.tokAcct[t];
    for (var id in this.acctTok) if (this.acctTok[id].t === t) return id;
    var p = C.jwtPayload(t);
    var c = p && (p.accountId || p.account_id || p.aid);
    return typeof c === 'string' ? c : null;
  };

  P.seen = function (m, u, auth, body, status, text) {
    var path = pathOf(u), tok = bearer(auth), ok = status >= 200 && status < 300, now = this.now();
    if (!ok) return;
    if (m === 'GET' && USER_PATHS[path] && tok) this.userTok = { t: tok, exp: C.tokenExpMs(tok, now + 60000) };
    if (path === '/v3/auth/account-token' && m === 'POST') {
      var j = jparse(text);
      if (j && typeof j.accessToken === 'string' && typeof j.accountId === 'string') {
        this.tokAcct[j.accessToken] = j.accountId;
        this.acctTok[j.accountId] = { t: j.accessToken, exp: C.num(j.accessExpiresAtMs) || C.tokenExpMs(j.accessToken, now + 60000) };
      }
    }
    if (m === 'GET' && path === '/v3/accounts') this.takeAccounts(jparse(text));
    if (m === 'GET' && path === '/v3/positions/opened') this.takePositions(jparse(text));
    if (m === 'GET' && path === '/v3/positions/opened-orders') this.takeOrders(jparse(text));
    var wm = WRITE_RE.exec(path);
    if (wm && tok) {
      var acct = this.acctOfToken(tok);
      if (acct && acct === this.settings.master && this.copyOn && this.settings.mirrorVestForm) {
        this.mirror(wm[1], m, jparse(body) || {}, jparse(text) || {}).catch(function () {});
      } else if (!acct && this.copyOn && this.settings.mirrorVestForm) {
        this.note(null, 'An order was placed in Vest\'s form but the account could not be told apart. It was not copied.', 'warn');
      }
      var s = this; setTimeout(function () { s.refresh().catch(noop); }, 1500);
    }
    this.emit();
  };

  // ---- reading -----------------------------------------------------------------------------------------------------------------------
  P.shapeOk = function (name, j) {
    var errs = C.shapeErrors(j, C.SCHEMAS[name]);
    if (errs.length) { this.setOff('Vest\'s ' + name + ' answer changed shape (' + errs[0] + '). Update Zoro for Vest.'); return false; }
    return true;
  };
  P.takeAccounts = function (j) {
    if (!j || !this.shapeOk('accounts', j)) return;
    this.accounts = j.accounts.filter(function (a) { return ACCT_OK[a.account_type]; }).map(function (a) {
      return { id: a.account_id, type: a.account_type, name: ACCT_NAMES[a.account_type] || 'Account', balance: C.num(a.amount) };
    });
  };
  P.takePositions = function (j) {
    if (!j || !this.shapeOk('positions', j)) return;
    var by = {};
    j.positions.forEach(function (p) { var a = p.accountId || p.account_id; if (a) (by[a] = by[a] || []).push(p); });
    this.positions = by;
  };
  P.takeOrders = function (j) {
    if (!j || !this.shapeOk('orders', j)) return;
    var by = {};
    j.orders.forEach(function (o) { var a = o.account_id || o.accountId; if (a) (by[a] = by[a] || []).push(o); });
    this.orders = by;
  };

  P.api = function (method, path, body, token) {
    var h = { Accept: 'application/json' };
    if (token) h.Authorization = 'Bearer ' + token;
    if (body !== undefined) h['Content-Type'] = 'application/json';
    return this.fetch0(GW + path, { method: method, headers: h, body: body === undefined ? undefined : JSON.stringify(body), credentials: 'omit' }).then(function (r) {
      return r.text().then(function (t) {
        var j = jparse(t);
        if (!r.ok) { var e = new Error(errText(j, r.status)); e.status = r.status; throw e; }
        return j;
      });
    });
  };
  P.userToken = function () {
    var u = this.userTok;
    if (u && u.exp > this.now() + 10000) return u.t;
    throw new Error('Waiting for your Vest session. Sign in to Vest, or click anything in Vest so it refreshes.');
  };
  P.acctToken = function (id) {
    var s = this, c = this.acctTok[id];
    if (c && c.exp > this.now() + 10000) return Promise.resolve(c.t);
    var ut;
    try { ut = this.userToken(); } catch (e) { return Promise.reject(e); }
    return this.api('POST', '/v3/auth/account-token', { accountId: id }, ut).then(function (j) {
      if (!s.shapeOk('accountToken', j)) throw new Error(s.offReason);
      s.acctTok[id] = { t: j.accessToken, exp: C.num(j.accessExpiresAtMs) || C.tokenExpMs(j.accessToken, s.now() + 60000) };
      return j.accessToken;
    });
  };

  // the Vest page code must still contain every endpoint this version uses (checked once per Vest release)
  P.checkBundle = function () {
    var s = this, doc = this.win.document;
    var el = doc.querySelector('script[type="module"][src*="/assets/index-"]');
    if (!el) return Promise.resolve(['Vest\'s page code was not found']);
    var src = el.getAttribute('src'), key = 'zv-bundle:' + src;
    try { if (this.win.sessionStorage.getItem(key) === 'ok') return Promise.resolve([]); } catch (e) { /* private mode */ }
    return this.fetch0(new URL(src, this.win.location.href).href).then(function (r) { return r.text(); }).then(function (t) {
      var miss = C.missingEndpoints(t);
      if (!miss.length) { try { s.win.sessionStorage.setItem(key, 'ok'); } catch (e) { /* fine */ } }
      return miss;
    });
  };

  P.start = function () {
    var s = this, host = this.win.location.hostname;
    if (host !== 'next.vestmarkets.com') { this.setOff('This version works on next.vestmarkets.com only.'); return Promise.resolve(); }
    return this.checkBundle().then(function (miss) {
      if (miss.length) { s.setOff('Vest changed its page (' + miss.slice(0, 3).join(', ') + ' not found).'); return; }
      return s.loadPublic().then(function () { s.checked = true; if (!s.offReason || s.offReason === 'Starting…') { s.ok = true; s.offReason = ''; } s.emit(); });
    }).catch(function (e) { s.setOff('Could not check Vest\'s page (' + e.message + ').'); });
  };
  P.loadPublic = function () {
    var s = this;
    return Promise.all([this.api('GET', '/v3/exchangeInfo'), this.api('GET', '/v3/ticker/latest')]).then(function (r) {
      if (!s.shapeOk('exchangeInfo', r[0]) || !s.shapeOk('ticker', r[1])) return;
      r[0].symbols.forEach(function (x) { s.spec[x.symbol] = { sizeDecimals: x.sizeDecimals, priceDecimals: x.priceDecimals, tick: String(x.minTickSize), status: x.tradingStatus, display: String(x.displaySymbol || x.symbol).toUpperCase() }; });
      r[1].tickers.forEach(function (x) { s.marks[x.symbol] = C.num(x.markPrice); });
    });
  };
  P.refresh = function () {
    var s = this, ut;
    try { ut = this.userToken(); } catch (e) { return Promise.reject(e); }
    return Promise.all([
      this.api('GET', '/v3/accounts?active=true&limit=500', undefined, ut).then(function (j) { s.takeAccounts(j); }),
      this.api('GET', '/v3/positions/opened', undefined, ut).then(function (j) { s.takePositions(j); }),
      this.api('GET', '/v3/positions/opened-orders', undefined, ut).then(function (j) { s.takeOrders(j); }),
      this.api('GET', '/v3/user-state', undefined, ut).then(function (j) {
        (j && Array.isArray(j.accounts) ? j.accounts : []).forEach(function (a) {
          var m = {}; (a.leverages || []).forEach(function (l) { if (l && l.symbol && C.num(l.leverage) > 0) m[l.symbol] = String(l.leverage); });
          if (a.accountId) s.lev[a.accountId] = m;
        });
      }).catch(noop),
      this.api('GET', '/v3/ticker/latest').then(function (j) { if (s.shapeOk('ticker', j)) j.tickers.forEach(function (x) { s.marks[x.symbol] = C.num(x.markPrice); }); }),
    ]).then(function () { s.emit(); });
  };

  // ---- helpers over the stored state ----------------------------------------------------------------------------------------------
  P.posFor = function (acct, sym) { return (this.positions[acct] || []).filter(function (p) { return p.symbol === sym && C.num(p.quantity) > 0; })[0] || null; };
  P.posById = function (acct, id) { return (this.positions[acct] || []).filter(function (p) { return p.positionId === id; })[0] || null; };
  P.levFor = function (acct, sym, fallback) { var p = this.posFor(acct, sym); return p && p.leverage ? String(p.leverage) : (this.lev[acct] && this.lev[acct][sym]) || fallback || '1'; };
  P.balanceOf = function (acct) { var a = this.accounts.filter(function (x) { return x.id === acct; })[0]; return a ? a.balance : NaN; };
  P.activeFollowers = function () {
    var s = this;
    return this.settings.followers.filter(function (f) { return !s.dropped[f] && s.accounts.some(function (a) { return a.id === f; }); })
      .map(function (f) { return { id: f, balance: s.balanceOf(f), enabled: true }; });
  };

  // every write goes through here: on/off check, the per-minute limit, the account token
  P.send = function (acct, method, path, body) {
    var s = this;
    if (!this.ok) return Promise.reject(new Error('Trading is off: ' + this.offReason));
    if (!this.limiter.take(1)) return Promise.reject(new Error('Order limit reached (' + this.settings.maxOrdersPerMin + ' per minute).'));
    return this.acctToken(acct).then(function (t) { return s.api(method, path, body, t); }).then(function (j) {
      if (C.shapeErrors(j, C.SCHEMAS.orderAck).length) { s.setOff('Vest\'s order answer changed shape.'); throw new Error('Unexpected answer from Vest.'); }
      return j;
    });
  };

  // ---- one account's order (used by the panel for master and followers) --------------------------------------------------------------
  // o: { symbol, isBuy, orderType 'market'|'limit', qty, price (limit), legs: { stop, targets:[{price, qty}] } }
  P.placeOne = function (acct, o, fallbackLev) {
    var s = this, pos = this.posFor(acct, o.symbol), lev = this.levFor(acct, o.symbol, fallbackLev);
    var tif = o.orderType === 'market' ? 'IOC' : 'GTC', px = o.orderType === 'limit' ? { price: o.price } : {};
    var sl = o.legs && o.legs.stop ? [{ executionType: 'market', triggerPrice: o.legs.stop }] : [];
    var tp = (o.legs && o.legs.targets || []).map(function (t) { var l = { executionType: 'market', triggerPrice: t.price }; if (t.qty) l.quantity = t.qty; return l; });
    if (!pos) {
      return this.send(acct, 'POST', '/v3/positions/open', Object.assign({ symbol: o.symbol, side: o.isBuy ? 'long' : 'short', orderType: o.orderType, quantity: o.qty, leverage: lev, timeInForce: tif, takeProfits: tp, stopLosses: sl }, px));
    }
    var isLong = pos.side === 'long';
    if (isLong === o.isBuy) {
      // adding to a position: no new legs (Vest keeps one full-size stop/target per position; use Stop to entry or Vest's TP/SL)
      if (sl.length || tp.length) this.note(acct, 'Added to the open ' + o.symbol + ' position. The bracket was not added; the position keeps its own stop and targets.', 'warn');
      return this.send(acct, 'POST', '/v3/positions/append', Object.assign({ symbol: o.symbol, positionId: pos.positionId, orderType: o.orderType, quantity: o.qty, leverage: lev, isBuy: o.isBuy, timeInForce: tif }, px));
    }
    // the other side: only reduce, never flip, and no bracket on a reduce
    var q = Math.min(C.num(o.qty), C.num(pos.quantity));
    if (q >= C.num(pos.quantity)) return this.send(acct, 'POST', '/v3/positions/close', Object.assign({ symbol: o.symbol, positionId: pos.positionId, orderType: o.orderType, leverage: lev }, o.orderType === 'limit' ? { limitPrice: o.price } : {}));
    return this.send(acct, 'POST', '/v3/positions/reduce', Object.assign({ symbol: o.symbol, positionId: pos.positionId, orderType: o.orderType, leverage: lev, quantity: C.floorSize(q, this.spec[o.symbol].sizeDecimals), timeInForce: tif, reduceOnly: true }, px));
  };

  // Plan a panel order: master + followers, each with its own size. -> { rows: [{ acct, qty, skip }], error }
  P.plan = function (o) {
    var sp = this.spec[o.symbol];
    if (!sp) return { error: 'Unknown market ' + o.symbol + '.' };
    if (sp.status !== 'TRADING') return { error: o.symbol + ' is not trading right now.' };
    if (!this.settings.master) return { error: 'Pick your master account in Copy first.' };
    var ref = o.orderType === 'limit' ? C.num(o.price) : this.marks[o.symbol];
    var rows = [{ acct: this.settings.master, qty: o.qty, skip: null }];
    if (this.copyOn) {
      var f = C.planFanout({ qty: o.qty }, this.activeFollowers(), { maxFollowers: this.settings.maxFollowers, sizing: this.settings.sizing, masterBalance: this.balanceOf(this.settings.master), sizeDecimals: sp.sizeDecimals });
      f.forEach(function (x) { rows.push({ acct: x.accountId, qty: x.qty, ratio: x.ratio, skip: x.skip }); });
    }
    var max = this.settings.maxNotionalUsd;
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].skip) continue;
      var e = C.checkOrder({ qty: rows[i].qty, price: ref, spec: sp, maxNotionalUsd: max });
      if (e) { if (i === 0) return { error: e }; rows[i].skip = e; }
    }
    var need = rows.filter(function (r) { return !r.skip; }).length * (1 + (o.legsCount || 0));
    if (need > this.limiter.room()) return { error: 'This needs ' + need + ' order requests; ' + this.limiter.room() + ' left this minute.' };
    return { rows: rows, ref: ref };
  };

  // Run a panel order: master first; followers only after the master was accepted.
  P.execute = function (o, plan) {
    var s = this, sp = this.spec[o.symbol], masterQty = C.num(o.qty), master = plan.rows[0];
    var legsFor = function (r) {
      if (!o.legs) return null;
      var t = (o.legs.targets || []).map(function (x) { return { price: x.price, qty: x.qty ? C.floorSize(C.num(x.qty) * C.num(r.qty) / masterQty, sp.sizeDecimals) : null }; });
      if (t.length === 2) t[1].qty = C.fromUnits(C.toUnits(r.qty, sp.sizeDecimals) - C.toUnits(t[0].qty, sp.sizeDecimals), sp.sizeDecimals);
      return { stop: o.legs.stop, targets: t };
    };
    var one = function (r) { return s.placeOne(r.acct, Object.assign({}, o, { qty: r.qty, legs: legsFor(r) }), o.leverage); };
    return one(master).then(function (res) {
      s.note(master.acct, (o.isBuy ? 'Buy ' : 'Sell ') + master.qty + ' ' + o.symbol + ' ' + o.orderType + ': accepted.', 'ok');
      var followers = plan.rows.slice(1);
      followers.filter(function (r) { return r.skip; }).forEach(function (r) { s.note(r.acct, 'Not copied: ' + r.skip, 'warn'); });
      return Promise.all(followers.filter(function (r) { return !r.skip; }).map(function (r) {
        return one(r).then(function (fr) {
          s.note(r.acct, 'Copied: ' + (o.isBuy ? 'buy ' : 'sell ') + r.qty + ' ' + o.symbol + '.', 'ok');
          if (res && res.orderId && fr && fr.orderId) (s.orderMap[res.orderId] = s.orderMap[res.orderId] || []).push({ acct: r.acct, orderId: fr.orderId });
        }, function (e) { s.drop(r.acct, e.message); });
      }));
    }, function (e) { s.note(master.acct, 'Master order refused: ' + e.message + ' Nothing was copied.', 'error'); throw e; })
      .then(function () { setTimeout(function () { s.refresh().catch(noop); }, 1500); });
  };

  P.drop = function (acct, why) {
    this.dropped[acct] = why;
    this.note(acct, 'Dropped out of copying: ' + why + ' Check this account in Vest.', 'error');
  };
  P.undrop = function (acct) { delete this.dropped[acct]; this.emit(); };
  P.setCopy = function (on) {
    if (on && !this.ok) { this.note(null, 'Copy cannot start: ' + this.offReason, 'error'); return; }
    if (on && !this.settings.master) { this.note(null, 'Pick a master account first.', 'warn'); return; }
    this.copyOn = !!on;
    this.note(null, on ? 'Copy is ON. Master actions go to ' + this.activeFollowers().length + ' follower(s).' : 'Copy is OFF. Nothing more is copied.', on ? 'ok' : 'info');
  };

  // the accounts an "all" button acts on
  P.scope = function () { var r = this.settings.master ? [this.settings.master] : []; if (this.copyOn) this.activeFollowers().slice(0, this.settings.maxFollowers).forEach(function (f) { r.push(f.id); }); return r; };

  // stop to entry (+/- points) on every account in scope, each from its own entry
  P.setStop = function (sym, points) {
    var s = this, sp = this.spec[sym];
    return Promise.all(this.scope().map(function (acct) {
      var pos = s.posFor(acct, sym);
      if (!pos) { s.note(acct, 'No ' + sym + ' position: stop not set.', 'warn'); return null; }
      var isLong = pos.side === 'long';
      var price = points > 0 ? C.pointsToPrice({ entry: pos.openPrice, points: points, isLong: isLong, kind: 'stop', tick: sp.tick, priceDecimals: sp.priceDecimals })
        : C.roundToTick(pos.openPrice, sp.tick, sp.priceDecimals, 'near');
      if (!price) { s.note(acct, 'Stop price is not valid.', 'error'); return null; }
      var legs = pos.stopLosses || [];
      var call = legs.length === 1 ? s.send(acct, 'PUT', '/v3/positions/stop-loss', { positionId: pos.positionId, stopLossId: legs[0].id, executionType: 'market', triggerPrice: price })
        : legs.length === 0 ? s.send(acct, 'POST', '/v3/positions/stop-loss', { positionId: pos.positionId, executionType: 'market', triggerPrice: price })
          : Promise.reject(new Error('This position has ' + legs.length + ' stops; change them in Vest.'));
      return call.then(function () { s.note(acct, 'Stop on ' + sym + ' set to ' + price + '.', 'ok'); }, function (e) { s.note(acct, 'Stop not set: ' + e.message, 'error'); });
    })).then(function () { setTimeout(function () { s.refresh().catch(noop); }, 1200); });
  };
  P.closeAll = function () {
    var s = this;
    return Promise.all(this.scope().map(function (acct) {
      return Promise.all((s.positions[acct] || []).filter(function (p) { return C.num(p.quantity) > 0; }).map(function (p) {
        return s.send(acct, 'POST', '/v3/positions/close', { symbol: p.symbol, positionId: p.positionId, orderType: 'market', leverage: String(p.leverage || '1') })
          .then(function () { s.note(acct, 'Closed ' + p.symbol + '.', 'ok'); }, function (e) { s.note(acct, 'Close ' + p.symbol + ' failed: ' + e.message, 'error'); });
      }));
    })).then(function () { setTimeout(function () { s.refresh().catch(noop); }, 1500); });
  };
  P.cancelAll = function () {
    var s = this;
    return Promise.all(this.scope().map(function (acct) {
      return Promise.all((s.orders[acct] || []).filter(function (o) { return o.row_type !== 'tpsl' && /^(pending|new|accepted|partially_filled)$/i.test(o.status); }).map(function (o) {
        return s.send(acct, 'POST', '/v3/positions/cancel-order', { orderId: o.id })
          .then(function () { s.note(acct, 'Cancelled order on ' + o.symbol + '.', 'ok'); }, function (e) { s.note(acct, 'Cancel failed: ' + e.message, 'error'); });
      }));
    })).then(function () { setTimeout(function () { s.refresh().catch(noop); }, 1500); });
  };

  // ---- copy what the member did in Vest's own form on the master account --------------------------------------------------------------
  P.mirror = function (kind, method, body, resp) {
    var s = this, master = this.settings.master;
    var sym = body.symbol || (body.positionId && (this.posById(master, body.positionId) || {}).symbol) || null;
    if (kind === 'cancel-order') {
      var mapped = this.orderMap[body.orderId] || [];
      if (!mapped.length) { this.note(null, 'Master order cancelled; no copied order to cancel.', 'info'); return Promise.resolve(); }
      return Promise.all(mapped.map(function (m) {
        if (s.dropped[m.acct]) return null;
        return s.send(m.acct, 'POST', '/v3/positions/cancel-order', { orderId: m.orderId }).then(function () { s.note(m.acct, 'Copied cancel.', 'ok'); }, function (e) { s.drop(m.acct, e.message); });
      }));
    }
    if (!sym || !this.spec[sym]) { this.note(null, 'A master action could not be matched to a market. It was not copied.', 'warn'); return Promise.resolve(); }
    var sp = this.spec[sym], masterQty = body.quantity != null ? String(body.quantity) : null;
    var rows = C.planFanout({ qty: masterQty }, this.activeFollowers(), { maxFollowers: this.settings.maxFollowers, sizing: this.settings.sizing, masterBalance: this.balanceOf(master), sizeDecimals: sp.sizeDecimals });
    var ref = C.num(body.price || body.limitPrice) || this.marks[sym];
    return Promise.all(rows.map(function (r) {
      var acct = r.accountId;
      if (r.skip) { s.note(acct, 'Not copied: ' + r.skip, 'warn'); return null; }
      if (r.qty != null) { var ce = C.checkOrder({ qty: r.qty, price: ref, spec: sp, maxNotionalUsd: s.settings.maxNotionalUsd }); if (ce) { s.note(acct, 'Not copied: ' + ce, 'warn'); return null; } }
      return s.mirrorOne(kind, method, body, resp, acct, sym, r).then(function (res) {
        if (res === null) return;
        s.note(acct, 'Copied ' + kind.replace('-', ' ') + ' on ' + sym + (r.qty ? ' (' + r.qty + ')' : '') + '.', 'ok');
        if (resp && resp.orderId && res && res.orderId) (s.orderMap[resp.orderId] = s.orderMap[resp.orderId] || []).push({ acct: acct, orderId: res.orderId });
      }, function (e) { s.drop(acct, e.message); });
    }));
  };
  P.mirrorOne = function (kind, method, b, resp, acct, sym, r) {
    var s = this, sp = this.spec[sym], pos = this.posFor(acct, sym), lev = this.levFor(acct, sym, b.leverage);
    var legs = function (arr) { return C.scaleLegs(arr, r.ratio, sp.sizeDecimals); };
    var skip = function (why) { s.note(acct, 'Not copied: ' + why, 'warn'); return Promise.resolve(null); };
    var px = b.price != null ? { price: b.price } : {};
    if (kind === 'open' || kind === 'append') {
      var isBuy = kind === 'open' ? b.side === 'long' : !!b.isBuy;
      if (!pos) {
        if (kind === 'append') return skip('this account has no ' + sym + ' position to add to.');
        return this.send(acct, 'POST', '/v3/positions/open', Object.assign({ symbol: sym, side: b.side, orderType: b.orderType, quantity: r.qty, leverage: lev, timeInForce: b.timeInForce, takeProfits: legs(b.takeProfits), stopLosses: legs(b.stopLosses) }, px));
      }
      if ((pos.side === 'long') !== isBuy) return skip('this account holds the other side of ' + sym + '.');
      return this.send(acct, 'POST', '/v3/positions/append', Object.assign({ symbol: sym, positionId: pos.positionId, orderType: b.orderType, quantity: r.qty, leverage: lev, isBuy: isBuy, timeInForce: b.timeInForce }, px));
    }
    if (!pos) return skip('this account has no ' + sym + ' position.');
    if (kind === 'close') return this.send(acct, 'POST', '/v3/positions/close', Object.assign({ symbol: sym, positionId: pos.positionId, orderType: b.orderType || 'market', leverage: lev }, b.limitPrice != null ? { limitPrice: b.limitPrice } : {}));
    if (kind === 'reduce') {
      if (C.num(r.qty) >= C.num(pos.quantity)) return this.send(acct, 'POST', '/v3/positions/close', { symbol: sym, positionId: pos.positionId, orderType: b.orderType || 'market', leverage: lev });
      return this.send(acct, 'POST', '/v3/positions/reduce', Object.assign({ symbol: sym, positionId: pos.positionId, orderType: b.orderType, leverage: lev, quantity: r.qty, timeInForce: b.timeInForce, reduceOnly: true }, px));
    }
    // take-profit / stop-loss: create, move or delete the matching leg
    var isTp = kind === 'take-profit', mine = (isTp ? pos.takeProfits : pos.stopLosses) || [], idKey = isTp ? 'takeProfitId' : 'stopLossId';
    var leg = { executionType: b.executionType || 'market', triggerPrice: b.triggerPrice };
    if (b.limitPrice != null) leg.limitPrice = b.limitPrice;
    if (method === 'POST') {
      if (b.quantity != null) { leg.quantity = C.floorSize(C.num(b.quantity) * (r.ratio || 1), sp.sizeDecimals); if (!(C.num(leg.quantity) > 0)) return skip('leg size rounds to 0.'); }
      return this.send(acct, 'POST', '/v3/positions/' + kind, Object.assign({ positionId: pos.positionId }, leg));
    }
    if (mine.length !== 1) return method === 'PUT' && mine.length === 0 ? this.send(acct, 'POST', '/v3/positions/' + kind, Object.assign({ positionId: pos.positionId }, leg))
      : skip('this account has ' + mine.length + ' ' + (isTp ? 'targets' : 'stops') + '; change them in Vest.');
    var body = { positionId: pos.positionId }; body[idKey] = mine[0].id;
    if (method === 'PUT') return this.send(acct, 'PUT', '/v3/positions/' + kind, Object.assign(body, leg));
    if (method === 'DELETE') return this.send(acct, 'DELETE', '/v3/positions/' + kind, body);
    return skip('unknown change.');
  };

  root.ZV_Engine = Engine;
  if (typeof module === 'object' && module.exports) module.exports = Engine;
})(typeof globalThis !== 'undefined' ? globalThis : this);

// ---- levels.js
// Zoro for Vest: TradeZoro levels on Vest's chart. The member's private levels link (Pro, from tradezoro.com/platform-levels) is kept by
// the extension/userscript host, not in Vest's page; the page only asks the host for "levels for SPY" and draws what comes back.
// Real data only: markets our feed does not cover get no lines. Education only. Not financial advice.
(function (root) {
  'use strict';
  var C = root.ZV_CORE || (typeof require === 'function' ? require('./core.js') : null);
  var REFRESH_MS = 5 * 60 * 1000;

  function Levels(win, host, onChange, mark) {
    this.mark = mark || function () { return NaN; };
    this.win = win; this.host = host; this.onChange = onChange || function () {};
    this.state = { status: 'idle', sym: null, u: null, data: null, error: null, hasLink: false, at: 0 };
    this.ids = []; this.drawnKey = null; this.show = true;
  }
  var P = Levels.prototype;
  P.chart = function () {
    var f = this.win.document.querySelector('iframe[id^="tradingview_"]');
    try { var api = f && f.contentWindow && f.contentWindow.tradingViewApi; return api && api.activeChart ? api.activeChart() : null; } catch (e) { return null; }
  };
  P.clear = function () {
    var ch = this.chart();
    if (ch) this.ids.forEach(function (id) { try { ch.removeEntity(id); } catch (e) { /* already gone */ } });
    this.ids = []; this.drawnKey = null;
  };
  P.draw = function () {
    var d = this.state.data, ch = this.chart();
    if (!this.show || !d || !ch) { if (!this.show) this.clear(); return; }
    var key = this.state.sym + '|' + d.updated + '|' + this.win.document.querySelector('iframe[id^="tradingview_"]').id;
    if (key === this.drawnKey && this.ids.length) return;
    this.clear();
    var self = this;
    d.levels.forEach(function (l) {
      try {
        var id = ch.createShape({ price: l.price, time: 0 }, { shape: 'horizontal_line', lock: true, disableSelection: true, disableSave: true, disableUndo: true,
          text: 'TZ ' + l.label, overrides: { linecolor: l.color || '#00adb5', textcolor: l.color || '#00adb5', linestyle: 2, linewidth: 1, showLabel: true, fontsize: 11, horzLabelsAlign: 'left', vertLabelsAlign: 'bottom', showPrice: true } });
        if (id && typeof id.then === 'function') id.then(function (x) { if (x) self.ids.push(x); }); else if (id) self.ids.push(id);
      } catch (e) { /* chart not ready; next tick retries */ }
    });
    this.drawnKey = key;
  };
  P.tick = function (vestSym) {
    var self = this, u = C.levelsSymbol(vestSym), st = this.state;
    if (vestSym !== st.sym) { this.clear(); st.sym = vestSym; st.u = u; st.data = null; st.error = null; st.at = 0; st.status = u ? 'idle' : 'none'; this.onChange(); }
    if (!u) return;
    if (st.status === 'loading') return;
    var from = C.levelsScaleFrom(vestSym);
    if (from && !(this.mark(vestSym) > 0 && this.mark(from) > 0)) return;   // wait for Vest's marks before moving levels
    if (st.data && this.now() - st.at < REFRESH_MS) { this.draw(); return; }
    if (st.error && this.now() - st.at < 60000) return;
    st.status = 'loading'; this.onChange();
    this.host.levels(u).then(function (r) {
      st.at = self.now(); st.hasLink = r.hasLink;
      if (r.status === 'nolink') { st.status = 'nolink'; st.data = null; }
      else if (r.status === 'inactive') { st.status = 'inactive'; st.data = null; }
      else if (r.status !== 'ok') { st.status = 'error'; st.error = r.error || 'Levels could not be loaded.'; }
      else {
        var errs = C.shapeErrors(r.json, C.LEVELS_SCHEMA);
        if (errs.length) { st.status = 'error'; st.error = 'Levels answer changed shape.'; }
        else if (u !== st.u) return;
        else {
          var lv = r.json.levels.filter(function (l) { return isFinite(l.price) && l.price > 0; }), notes = (r.json.notes || []).slice();
          if (from) {
            lv = C.scaleLevels(lv, self.mark(vestSym) / self.mark(from), 2);
            notes.push(u + ' levels moved to the ' + vestSym + ' price scale using Vest\'s two mark prices.');
          }
          if (!lv) { st.status = 'error'; st.error = 'No mark price to move ' + u + ' levels to this market yet.'; st.at = self.now() - 50000; }
          else { st.status = 'ok'; st.error = null; st.data = { updated: r.json.updated, levels: lv, notes: notes }; }
        }
      }
      self.onChange(); self.draw();
    }, function (e) { st.at = self.now(); st.status = 'error'; st.error = String(e && e.message || e); self.onChange(); });
  };
  P.now = function () { return Date.now(); };
  P.reload = function () { this.state.at = 0; this.state.data = null; this.state.error = null; this.state.status = 'idle'; this.clear(); };

  root.ZV_Levels = Levels;
  if (typeof module === 'object' && module.exports) module.exports = Levels;
})(typeof globalThis !== 'undefined' ? globalThis : this);

// ---- ui.js
// Zoro for Vest: the panel. Built in a closed shadow root (Vest's CSS cannot reach it, ours cannot leak).
// All text the panel shows from Vest or the levels feed goes through textContent / esc(). Education only. Not financial advice.
(function (root) {
  'use strict';
  var C = root.ZV_CORE;
  var VERSION = '1.0.0';
  var LS_SET = 'zv:settings', LS_TERMS = 'zv:terms', SS_CONFIRM = 'zv:confirm';
  var ICON = {
    min: '<svg viewBox="0 0 24 24"><path d="M5 12h14"/></svg>',
    gear: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
    close: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function fmt(n, d) { n = C.num(n); return isFinite(n) ? n.toLocaleString('en-US', { minimumFractionDigits: d || 0, maximumFractionDigits: d == null ? 2 : d }) : '–'; }
  function usd(n) { n = C.num(n); return isFinite(n) ? '$' + n.toLocaleString('en-US', { maximumFractionDigits: 2 }) : '–'; }
  function clock(t) { var d = new Date(t); return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2) + ':' + ('0' + d.getSeconds()).slice(-2); }
  function readJson(store, k) { try { return JSON.parse(store.getItem(k) || 'null'); } catch (e) { return null; } }

  function UI(win, engine, levels, host, assets) {
    this.win = win; this.doc = win.document; this.E = engine; this.L = levels; this.host = host; this.assets = assets || {};
    this.tab = 'trade'; this.sheet = null; this.sym = null;
    var st = C.clampSettings(readJson(win.localStorage, LS_SET));
    engine.setSettings(st);
    this.terms = readJson(win.localStorage, LS_TERMS);
    var cf = win.sessionStorage.getItem(SS_CONFIRM); this.confirm = cf !== 'off';
    this.f = { type: 'market', mode: 'qty', qty: '', risk: '', price: '', stop: '', t1: '', t2: '' };
  }
  var P = UI.prototype;
  P.save = function (patch) {
    var s = Object.assign({}, this.E.settings, patch || {});
    this.E.setSettings(s);
    try { this.win.localStorage.setItem(LS_SET, JSON.stringify(this.E.settings)); } catch (e) { /* storage full: settings stay for this visit */ }
  };
  P.accepted = function () { return this.terms && this.terms.v === C.TERMS_VERSION; };

  P.mount = function () {
    var self = this, d = this.doc;
    var hostEl = d.createElement('div'); hostEl.id = 'zoro-for-vest';
    var sr = hostEl.attachShadow({ mode: 'closed' });
    this.sr = sr;
    sr.innerHTML = '<style>' + (this.assets.css || '') + '</style>' +
      '<div class="zv" role="region" aria-label="TradeZoro for Vest">' +
      '<button class="pill" type="button" aria-label="Open TradeZoro panel"><img class="logo" alt="" src="' + esc(this.assets.logo || '') + '"><span class="lbl">TradeZoro</span><span class="dot"></span></button>' +
      '<div class="card">' +
      '<div class="hd"><img class="logo" alt="TradeZoro" src="' + esc(this.assets.logo || '') + '"><div class="ttl">TradeZoro<small>for Vest</small></div><span class="dot" title=""></span><div class="sp"></div>' +
      '<button class="icon" data-act="settings" type="button" aria-label="Settings">' + ICON.gear + '</button>' +
      '<button class="icon" data-act="min" type="button" aria-label="Minimise">' + ICON.min + '</button></div>' +
      '<div class="status" aria-live="polite"></div>' +
      '<div class="tabs"><div class="seg" role="group" aria-label="Sections">' +
      ['trade', 'copy', 'levels', 'log'].map(function (t) { return '<button type="button" data-tab="' + t + '" aria-pressed="' + (t === 'trade') + '">' + t.charAt(0).toUpperCase() + t.slice(1) + '</button>'; }).join('') +
      '</div></div><div class="body"></div></div></div>';
    this.root = sr.querySelector('.zv');
    (d.body || d.documentElement).appendChild(hostEl);
    this.root.addEventListener('click', function (e) { self.click(e); });
    this.root.addEventListener('input', function (e) { self.input(e); });
    this.root.addEventListener('change', function (e) { self.change(e); });
    this.drag();
    if (this.win.innerWidth <= 600) this.root.classList.add('min');
    this.E.on(function () { self.refresh(); });
    this.render();
    if (!this.accepted()) this.openTerms();
    this.timer = this.win.setInterval(function () { self.poll(); }, 1000);
    this.poll();
  };

  // ---- position: drag the header on desktop; never off screen --------------------------------------------------------------------------
  P.drag = function () {
    var self = this, hd = this.root.querySelector('.hd'), z = this.root;
    var st = this.E.settings;
    if (st.panelX !== null && this.win.innerWidth > 600) { z.style.left = Math.max(0, Math.min(st.panelX, this.win.innerWidth - 120)) + 'px'; z.style.top = Math.max(0, Math.min(st.panelY, this.win.innerHeight - 60)) + 'px'; z.style.bottom = 'auto'; }
    hd.addEventListener('pointerdown', function (e) {
      if (e.target.closest('button') || self.win.innerWidth <= 600) return;
      var r = z.getBoundingClientRect(), dx = e.clientX - r.left, dy = e.clientY - r.top;
      hd.setPointerCapture(e.pointerId);
      var mv = function (ev) {
        var x = Math.max(0, Math.min(ev.clientX - dx, self.win.innerWidth - r.width)), y = Math.max(0, Math.min(ev.clientY - dy, self.win.innerHeight - 60));
        z.style.left = x + 'px'; z.style.top = y + 'px'; z.style.bottom = 'auto';
      };
      var up = function () { hd.removeEventListener('pointermove', mv); hd.removeEventListener('pointerup', up); var b = z.getBoundingClientRect(); self.save({ panelX: Math.round(b.left), panelY: Math.round(b.top) }); };
      hd.addEventListener('pointermove', mv); hd.addEventListener('pointerup', up);
    });
  };

  // ---- every second: market from the URL, theme, levels -------------------------------------------------------------------------------
  P.symbolFromUrl = function () {
    var m = /^\/trade\/([^/?#]+)/.exec(this.win.location.pathname);
    if (!m) return null;
    var s = decodeURIComponent(m[1]).toUpperCase(), sp = this.E.spec;
    if (sp[s]) return s;
    for (var k in sp) if (sp[k].display === s) return k;
    return sp[s + '-PERP'] ? s + '-PERP' : sp[s + '-USD-PERP'] ? s + '-USD-PERP' : s;
  };
  P.poll = function () {
    this.root.style.display = /^\/trade(\/|$)/.test(this.win.location.pathname) ? '' : 'none';
    var t = this.E.settings.theme, dark = t === 'dark' || (t === 'auto' && this.doc.documentElement.classList.contains('dark'));
    this.root.classList.toggle('light', !dark);
    var s = this.symbolFromUrl();
    if (s !== this.sym) { this.sym = s; this.refresh(); }
    if (this.L) { this.L.show = this.E.settings.showLevels; this.L.tick(s); }
  };

  // ---- rendering --------------------------------------------------------------------------------------------------------------------
  P.render = function () {
    var self = this;
    this.root.querySelectorAll('[data-tab]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-tab') === self.tab)); });
    var body = this.root.querySelector('.card > .body');
    body.innerHTML = this['tab_' + this.tab]();
    this.refresh();
  };
  P.refresh = function () {
    if (!this.root) return;
    var E = this.E, st = this.root.querySelector('.status'), dots = this.root.querySelectorAll('.dot');
    var on = E.ok && this.accepted(), cls = !on ? 'off' : E.copyOn ? 'copy' : 'ok';
    dots.forEach(function (d) { d.className = 'dot ' + cls; });
    var nf = E.activeFollowers().length;
    if (!this.accepted()) st.innerHTML = 'Accept the terms to start.';
    else if (!E.ok) st.innerHTML = esc(E.offReason || 'Trading is off.');
    else if (!E.userTok) st.innerHTML = 'Sign in to Vest. The panel uses your Vest session in this tab.';
    else st.innerHTML = 'Master <b>' + esc(E.settings.master ? E.acctName(E.settings.master) : 'not set') + '</b> · Copy <b>' + (E.copyOn ? 'ON, ' + nf + ' follower' + (nf === 1 ? '' : 's') : 'OFF') + '</b>';
    st.classList.toggle('off', !on);
    var fn = this['up_' + this.tab]; if (fn) fn.call(this);
  };

  // Trade ----------------------------------------------------------------------------------------------------------------------------
  P.tab_trade = function () {
    var f = this.f;
    var seg = function (name, opts, val) { return '<div class="seg" role="group">' + opts.map(function (o) { return '<button type="button" data-seg="' + name + '" data-v="' + o[0] + '" aria-pressed="' + (o[0] === val) + '">' + o[1] + '</button>'; }).join('') + '</div>'; };
    return '<div class="row"><div class="fld"><span>Market</span><div class="in" style="display:flex;align-items:center" id="zv-sym">–</div></div>' +
      '<div class="fld"><span>Mark price</span><div class="in" style="display:flex;align-items:center" id="zv-mark">–</div></div></div>' +
      seg('type', [['market', 'Market'], ['limit', 'Limit']], f.type) +
      '<div class="row"><div class="fld"><span>Size in</span>' + seg('mode', [['qty', 'Contracts'], ['risk', '$ risk']], f.mode) + '</div></div>' +
      '<div class="row">' +
      '<label class="fld" ' + (f.mode === 'qty' ? '' : 'hidden') + '><span>Contracts</span><input class="in" inputmode="decimal" data-f="qty" value="' + esc(f.qty) + '" placeholder="0"></label>' +
      '<label class="fld" ' + (f.mode === 'risk' ? '' : 'hidden') + '><span>Risk ($)</span><input class="in" inputmode="decimal" data-f="risk" value="' + esc(f.risk) + '" placeholder="0"></label>' +
      '<label class="fld" ' + (f.type === 'limit' ? '' : 'hidden') + '><span>Limit price</span><input class="in" inputmode="decimal" data-f="price" value="' + esc(f.price) + '" placeholder="0"></label></div>' +
      '<div class="row">' +
      '<label class="fld"><span>Stop (pts)</span><input class="in" inputmode="decimal" data-f="stop" value="' + esc(f.stop) + '" placeholder="–"></label>' +
      '<label class="fld"><span>Target 1 (pts)</span><input class="in" inputmode="decimal" data-f="t1" value="' + esc(f.t1) + '" placeholder="–"></label>' +
      '<label class="fld"><span>Target 2 (pts)</span><input class="in" inputmode="decimal" data-f="t2" value="' + esc(f.t2) + '" placeholder="–"></label></div>' +
      '<p class="hint" id="zv-calc">&nbsp;</p>' +
      '<div class="btns"><button class="btn pri" type="button" data-act="buy">Buy</button><button class="btn sell" type="button" data-act="sell">Sell</button></div>' +
      '<div class="btns"><button class="btn sm" type="button" data-act="be">Breakeven</button><button class="btn sm" type="button" data-act="closeall">Close all</button><button class="btn sm" type="button" data-act="cancelall">Cancel all</button></div>' +
      '<p class="hint" id="zv-pos">&nbsp;</p>' +
      '<div class="li" style="padding:0;min-height:40px;border:0"><div class="t"><b>Confirm each order</b><i>For this visit. On by default.</i></div><label class="sw"><input type="checkbox" data-set="confirm" ' + (this.confirm ? 'checked' : '') + ' aria-label="Confirm each order"><span></span></label></div>';
  };
  P.calc = function () {
    var E = this.E, f = this.f, sym = this.sym, sp = E.spec[sym];
    if (!sp) return { error: sym ? 'Open a Vest market to trade.' : 'Open a market on Vest (Trade page).' };
    var ref = f.type === 'limit' ? C.num(f.price) : E.marks[sym];
    if (!(ref > 0)) return { error: f.type === 'limit' ? 'Enter a limit price.' : 'No mark price yet.', sp: sp };
    if (f.type === 'limit') { var rp = C.roundToTick(ref, sp.tick, sp.priceDecimals, 'near'); if (C.num(rp) !== ref) return { error: 'Limit price must be on the ' + sp.tick + ' tick.', sp: sp }; }
    var qty = f.mode === 'risk' ? C.sizeFromRisk({ riskUsd: f.risk, stopPoints: f.stop, sizeDecimals: sp.sizeDecimals }) : String(f.qty || '').trim();
    if (f.mode === 'risk' && !(C.num(f.stop) > 0)) return { error: '$ risk needs a stop in points.', sp: sp };
    if (!(C.num(qty) > 0)) return { error: f.mode === 'risk' ? 'Risk is too small for one size step.' : 'Enter a size.', sp: sp };
    return { sp: sp, ref: ref, qty: qty };
  };
  P.legsFor = function (isLong, c) {
    var b = C.bracket({ spec: { sizeDecimals: c.sp.sizeDecimals, priceDecimals: c.sp.priceDecimals, tick: c.sp.tick }, entry: c.ref, qty: c.qty, isLong: isLong, stopPoints: this.f.stop, targetPoints: [this.f.t1, this.f.t2] });
    return b;
  };
  P.up_trade = function () {
    var E = this.E, sym = this.sym, el = this.root.querySelector('#zv-sym'); if (!el) return;
    el.textContent = sym || '–';
    var sp = E.spec[sym];
    this.root.querySelector('#zv-mark').textContent = sp && E.marks[sym] ? fmt(E.marks[sym], sp.priceDecimals) : '–';
    var c = this.calc(), h = this.root.querySelector('#zv-calc');
    if (c.error) { h.textContent = c.error; h.className = 'hint'; }
    else {
      var bl = this.legsFor(true, c), bs = this.legsFor(false, c);
      if (bl.error) { h.textContent = bl.error; h.className = 'hint warn'; }
      else {
        var parts = [c.qty + ' contracts ≈ ' + usd(C.num(c.qty) * c.ref)];
        if (bl.stop) parts.push('stop ' + bl.stop + ' long / ' + bs.stop + ' short, risk ≈ ' + usd(bl.riskUsd));
        if (bl.targets.length) parts.push('targets ' + bl.targets.map(function (t) { return t.price; }).join(', ') + ' long');
        h.textContent = parts.join(' · ') + (this.f.type === 'market' && (bl.stop || bl.targets.length) ? '. Market: points count from the mark price.' : '.');
        h.className = 'hint';
      }
    }
    var pe = this.root.querySelector('#zv-pos'), m = E.settings.master, p = m && sym ? E.posFor(m, sym) : null;
    pe.textContent = p ? 'Master: ' + (p.side === 'long' ? 'long ' : 'short ') + p.quantity + ' ' + sym + ' from ' + p.openPrice + (p.stopLosses && p.stopLosses.length ? ', stop ' + p.stopLosses[0].triggerPrice : ', no stop') : (m ? 'Master has no ' + (sym || '') + ' position.' : '');
    var can = E.ok && this.accepted() && !c.error && !!E.userTok;
    this.root.querySelectorAll('[data-act="buy"],[data-act="sell"]').forEach(function (b) { b.disabled = !can; });
    var can2 = E.ok && this.accepted() && !!E.userTok && !!m;
    this.root.querySelectorAll('[data-act="be"],[data-act="closeall"],[data-act="cancelall"]').forEach(function (b) { b.disabled = !can2; });
  };
  P.order = function (isBuy) {
    var self = this, E = this.E, c = this.calc();
    if (c.error) return;
    var b = this.legsFor(isBuy, c); if (b.error) { E.note(null, b.error, 'error'); return; }
    var o = { symbol: this.sym, isBuy: isBuy, orderType: this.f.type, qty: c.qty, price: this.f.type === 'limit' ? C.roundToTick(c.ref, c.sp.tick, c.sp.priceDecimals, 'near') : undefined,
      legs: b.stop || b.targets.length ? { stop: b.stop, targets: b.targets } : null, legsCount: 0 };
    var plan = E.plan(o);
    if (plan.error) { E.note(null, plan.error, 'error'); return; }
    var go = function () { E.execute(o, plan).catch(function () {}); };
    if (!this.confirm) return go();
    var rows = plan.rows.map(function (r, i) { return '<dt>' + esc(E.acctName(r.acct)) + (i === 0 ? ' (master)' : '') + '</dt><dd>' + (r.skip ? '<span style="color:var(--amber)">' + esc(r.skip) + '</span>' : esc(r.qty)) + '</dd>'; }).join('');
    this.openSheet((isBuy ? 'Buy ' : 'Sell ') + esc(o.symbol),
      '<dl class="sum"><dt>Type</dt><dd>' + esc(o.orderType === 'limit' ? 'Limit at ' + o.price : 'Market') + '</dd>' +
      '<dt>Stop</dt><dd>' + esc(b.stop || 'none') + '</dd><dt>Targets</dt><dd>' + esc(b.targets.map(function (t) { return t.price + (t.qty ? ' × ' + t.qty : ''); }).join(', ') || 'none') + '</dd>' +
      '<dt>Value (master)</dt><dd>≈ ' + esc(usd(C.num(o.qty) * plan.ref)) + '</dd></dl>' +
      '<p class="hint">Sizes per account</p><dl class="sum">' + rows + '</dl>' +
      '<p class="hint warn">Real orders on real Vest accounts. Copies can be late or fail. Education only. Not financial advice.</p>',
      'Send ' + plan.rows.filter(function (r) { return !r.skip; }).length + ' order' + (plan.rows.filter(function (r) { return !r.skip; }).length === 1 ? '' : 's'), go);
  };
  P.allAction = function (kind) {
    var E = this.E, self = this, n = E.scope().length;
    var run = { be: function () { return E.setStop(self.sym, 0); }, closeall: function () { return E.closeAll(); }, cancelall: function () { return E.cancelAll(); } }[kind];
    var title = { be: 'Stop to entry on ' + (this.sym || ''), closeall: 'Close all positions', cancelall: 'Cancel all open orders' }[kind];
    var text = { be: 'Moves the stop to each account\'s own entry price on ' + (this.sym || '') + '.', closeall: 'Market-closes every open position.', cancelall: 'Cancels every open entry order (stops and targets stay).' }[kind];
    var go = function () { run().catch(function (e) { E.note(null, e.message, 'error'); }); };
    if (!this.confirm) return go();
    this.openSheet(esc(title), '<p>' + esc(text) + '</p><p class="hint">Accounts: ' + n + ' (master' + (E.copyOn ? ' + followers' : ' only, copy is off') + ').</p><p class="hint warn">Real orders on real Vest accounts.</p>', 'Confirm', go);
  };

  // Copy ----------------------------------------------------------------------------------------------------------------------------
  P.tab_copy = function () {
    return '<div class="kill" id="zv-kill"><div class="t"><b>Copy</b><i id="zv-kill-t"></i></div><label class="sw"><input type="checkbox" data-set="copy" aria-label="Copy on or off"><span></span></label></div>' +
      '<label class="fld"><span>Master account</span><select class="in" data-set="master" id="zv-master"></select></label>' +
      '<div class="fld"><span>Followers</span><div class="list" id="zv-fol"></div></div>' +
      '<div class="fld"><span>Follower size</span><div class="seg" role="group"><button type="button" data-seg="sizing" data-v="equal">Same as master (1:1)</button><button type="button" data-seg="sizing" data-v="balance">Scaled to balance</button></div></div>' +
      '<div class="li" style="padding:0;min-height:40px;border:0"><div class="t"><b>Copy Vest\'s own form too</b><i>Orders you place on the master in Vest\'s order form, chart or tables.</i></div><label class="sw"><input type="checkbox" data-set="mirror" aria-label="Copy Vest\'s own form"><span></span></label></div>' +
      '<p class="hint">Followers copy entries, stops, targets, moves and closes made on the master. A follower that errors drops out and is shown here.</p>';
  };
  P.up_copy = function () {
    var E = this.E, st = E.settings, self = this, k = this.root.querySelector('#zv-kill'); if (!k) return;
    var nf = E.activeFollowers().length;
    k.classList.toggle('on', E.copyOn);
    k.querySelector('input').checked = E.copyOn;
    k.querySelector('input').disabled = !E.ok || !this.accepted();
    this.root.querySelector('#zv-kill-t').textContent = E.copyOn ? 'ON. Master actions go to ' + nf + ' follower' + (nf === 1 ? '' : 's') + '. Turn off to stop at once.' : 'OFF. Nothing is copied.';
    var sel = this.root.querySelector('#zv-master');
    if (this.sr.activeElement !== sel) {
      sel.innerHTML = '<option value="">' + (E.accounts.length ? 'Pick an account' : 'Sign in to Vest to see accounts') + '</option>' + E.accounts.map(function (a) {
        return '<option value="' + esc(a.id) + '"' + (a.id === st.master ? ' selected' : '') + '>' + esc(a.name + ' ' + C.shortId(a.id) + ' · ' + usd(a.balance)) + '</option>';
      }).join('');
    }
    var fl = this.root.querySelector('#zv-fol'), others = E.accounts.filter(function (a) { return a.id !== st.master; });
    var html = others.length ? others.map(function (a) {
      var on = st.followers.indexOf(a.id) >= 0, bad = E.dropped[a.id];
      return '<div class="li"><div class="t"><b>' + esc(a.name + ' ' + C.shortId(a.id)) + '</b><i class="' + (bad ? 'err' : '') + '">' + esc(bad ? 'Dropped: ' + bad : usd(a.balance)) + '</i></div>' +
        (bad ? '<button class="btn sm" type="button" data-retry="' + esc(a.id) + '">Retry</button>' : '') +
        '<label class="sw"><input type="checkbox" data-fol="' + esc(a.id) + '" ' + (on ? 'checked' : '') + ' aria-label="Follow with ' + esc(a.name) + '"><span></span></label></div>';
    }).join('') : '<div class="empty">' + (E.accounts.length ? 'Only one account. Add a second Vest account to copy.' : 'No accounts yet.') + '</div>';
    if (fl.innerHTML !== html) fl.innerHTML = html;
    this.root.querySelectorAll('[data-seg="sizing"]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-v') === st.sizing)); });
    this.root.querySelector('[data-set="mirror"]').checked = st.mirrorVestForm;
  };

  // Levels --------------------------------------------------------------------------------------------------------------------------
  P.tab_levels = function () {
    return '<div class="li" style="padding:0;min-height:40px;border:0"><div class="t"><b>Show on Vest\'s chart</b><i>GEX levels, Zoro Range, Zoro Levels, big dark pool prints</i></div><label class="sw"><input type="checkbox" data-set="showLevels" aria-label="Show levels on the chart"><span></span></label></div>' +
      '<div id="zv-lv"></div>' +
      '<div class="fld"><span>Your private levels link (Pro)</span><div class="row"><input class="in" id="zv-link" placeholder="Paste the link from tradezoro.com/platform-levels" autocomplete="off" spellcheck="false"><button class="btn sm" type="button" data-act="savelink" style="flex:none">Save</button></div>' +
      '<p class="hint" id="zv-link-h">The link stays in this browser\'s extension storage, not on Vest\'s page.</p></div>';
  };
  P.up_levels = function () {
    var box = this.root.querySelector('#zv-lv'); if (!box || !this.L) return;
    this.root.querySelector('[data-set="showLevels"]').checked = this.E.settings.showLevels;
    var s = this.L.state, html;
    if (!this.sym) html = '<p class="hint">Open a market on Vest.</p>';
    else if (s.status === 'none') html = '<p class="hint">No TradeZoro levels for ' + esc(this.sym) + '. Levels cover SPX, NDX, SPY and QQQ on Vest. Crypto and other markets have none yet.</p>';
    else if (s.status === 'nolink') html = '<div class="banner">TradeZoro levels on Vest\'s chart are part of Pro. <a class="a" href="https://tradezoro.com/pro" target="_blank" rel="noopener">See Pro</a></div>';
    else if (s.status === 'inactive') html = '<div class="banner warn">This levels link is off (a new link was made, or Pro ended). Make a new one at <a class="a" href="https://tradezoro.com/platform-levels" target="_blank" rel="noopener">tradezoro.com/platform-levels</a>.</div>';
    else if (s.status === 'error') html = '<p class="hint err">' + esc(s.error) + '</p>';
    else if (s.status !== 'ok' || !s.data) html = '<p class="hint">Loading levels…</p>';
    else {
      html = '<p class="hint">' + esc(this.sym + ' (' + s.u + ' levels) · ' + C.agoText(C.minsAgo(s.data.updated))) + '</p><div class="list">' +
        (s.data.levels.length ? s.data.levels.map(function (l) { return '<div class="li" style="min-height:36px"><span class="dot" style="background:' + esc(/^#[0-9a-f]{3,8}$/i.test(l.color || '') ? l.color : '#00adb5') + '"></span><div class="t"><b>' + esc(l.label) + '</b></div><span>' + esc(fmt(l.price, 2)) + '</span></div>'; }).join('') : '<div class="empty">No levels in the feed right now.</div>') +
        '</div>' + s.data.notes.map(function (n) { return '<p class="hint">' + esc(n) + '</p>'; }).join('') + '<p class="hint">Education only. Not financial advice.</p>';
    }
    if (box.innerHTML !== html) box.innerHTML = html;
  };

  // Log -----------------------------------------------------------------------------------------------------------------------------
  P.tab_log = function () { return '<div class="log" id="zv-log"></div><button class="btn sm" type="button" data-act="clearlog">Clear log</button>'; };
  P.up_log = function () {
    var E = this.E, el = this.root.querySelector('#zv-log'); if (!el) return;
    var html = E.log.length ? E.log.map(function (l) { return '<div class="lg ' + esc(l.level) + '"><span class="m">' + clock(l.t) + (l.acct ? ' · ' + esc(E.acctName(l.acct)) : '') + '</span><br><span class="x">' + esc(l.text) + '</span></div>'; }).join('') : '<div class="empty">Nothing yet. Every order, copy and error shows here.</div>';
    if (el.innerHTML !== html) el.innerHTML = html;
  };

  // sheets ----------------------------------------------------------------------------------------------------------------------------
  P.openSheet = function (title, html, okText, onOk, opts) {
    var self = this; this.closeSheet();
    var s = this.doc.createElement('div'); s.className = 'sheet'; s.setAttribute('role', 'dialog'); s.setAttribute('aria-modal', 'true');
    s.innerHTML = '<div class="hd" style="cursor:default"><h3>' + title + '</h3><div class="sp"></div>' + (opts && opts.noClose ? '' : '<button class="icon" type="button" data-sh="x" aria-label="Close">' + ICON.close + '</button>') + '</div>' +
      '<div class="body">' + html + '</div><div class="foot">' + (opts && opts.extra || '') + '<div class="btns">' + (opts && opts.noClose ? '' : '<button class="btn" type="button" data-sh="x">Cancel</button>') + '<button class="btn pri" type="button" data-sh="ok">' + esc(okText) + '</button></div></div>';
    this.root.querySelector('.card').appendChild(s);
    this.sheet = s;
    s.addEventListener('click', function (e) {
      var b = e.target.closest('[data-sh]'); if (!b) return;
      if (b.getAttribute('data-sh') === 'ok') { if (opts && opts.check && !opts.check(s)) return; self.closeSheet(); onOk(s); } else self.closeSheet();
    });
    var ok = s.querySelector('[data-sh="ok"]'); if (ok) ok.focus();
  };
  P.closeSheet = function () { if (this.sheet) { this.sheet.remove(); this.sheet = null; } };
  P.openTerms = function () {
    var self = this;
    this.root.classList.remove('min');
    this.openSheet('Before you start',
      '<ul><li>This panel places <b>real orders on your real Vest accounts</b>, using your own Vest session in this tab.</li>' +
      '<li>Copies to follower accounts can be <b>late, different in price or size, or fail</b>. A follower that errors is dropped and shown in red.</li>' +
      '<li>You are responsible for every order, size and account. Nothing trades by itself: every order starts from your own click.</li>' +
      '<li>Education only. Not financial advice. No result is promised.</li>' +
      '<li>TradeZoro is <b>not affiliated with Vest</b>. You must follow Vest\'s terms, including its country restrictions.</li>' +
      '<li>Your Vest session and keys never leave this browser. TradeZoro receives nothing from this panel.</li></ul>',
      'I agree', function () {
        self.terms = { v: C.TERMS_VERSION, at: new Date().toISOString() };
        try { self.win.localStorage.setItem(LS_TERMS, JSON.stringify(self.terms)); } catch (e) { /* asked again next visit */ }
        self.E.note(null, 'Terms accepted (version ' + C.TERMS_VERSION + ').', 'info'); self.refresh();
      }, {
        noClose: true, extra: '<label class="chk"><input type="checkbox" id="zv-agree"> I have read this and accept it.</label><p class="hint err" id="zv-agree-h" hidden>Tick the box first.</p>',
        check: function (s) { var ok = s.querySelector('#zv-agree').checked; s.querySelector('#zv-agree-h').hidden = ok; return ok; },
      });
  };
  P.openSettings = function () {
    var self = this, st = this.E.settings, H = C.HARD;
    var fld = function (k, label, hard) { return '<label class="fld"><span>' + label + '</span><input class="in" inputmode="numeric" id="zv-s-' + k + '" value="' + esc(st[k]) + '"><p class="hint">Up to ' + fmt(hard, 0) + '.</p></label>'; };
    this.openSheet('Settings',
      fld('maxNotionalUsd', 'Max value per order ($)', H.maxNotionalUsd) + fld('maxFollowers', 'Max followers', H.maxFollowers) + fld('maxOrdersPerMin', 'Max order requests per minute (all accounts)', H.maxOrdersPerMin) +
      '<div class="fld"><span>Theme</span><div class="seg" role="group">' + [['auto', 'Match Vest'], ['dark', 'Dark'], ['light', 'Light']].map(function (o) { return '<button type="button" data-th="' + o[0] + '" aria-pressed="' + (st.theme === o[0]) + '">' + o[1] + '</button>'; }).join('') + '</div></div>' +
      '<p class="hint">Zoro for Vest ' + VERSION + '. Works on next.vestmarkets.com. Turns trading off by itself if Vest changes its page.</p>' +
      '<button class="btn sm" type="button" data-th="terms">Read the terms again</button>',
      'Save', function (s) {
        self.save({ maxNotionalUsd: s.querySelector('#zv-s-maxNotionalUsd').value, maxFollowers: s.querySelector('#zv-s-maxFollowers').value, maxOrdersPerMin: s.querySelector('#zv-s-maxOrdersPerMin').value, theme: s.getAttribute('data-theme') || st.theme });
        self.E.note(null, 'Settings saved.', 'info'); self.poll();
      });
    this.sheet.addEventListener('click', function (e) {
      var b = e.target.closest('[data-th]'); if (!b) return;
      var v = b.getAttribute('data-th');
      if (v === 'terms') { self.terms = null; self.openTerms(); return; }
      self.sheet.setAttribute('data-theme', v);
      self.sheet.querySelectorAll('[data-th]').forEach(function (x) { if (x.getAttribute('data-th') !== 'terms') x.setAttribute('aria-pressed', String(x === b)); });
    });
  };

  // events ----------------------------------------------------------------------------------------------------------------------------
  P.click = function (e) {
    var self = this, E = this.E, t = e.target;
    if (t.closest('.pill')) { this.root.classList.remove('min'); return; }
    var tb = t.closest('[data-tab]'); if (tb) { this.tab = tb.getAttribute('data-tab'); this.render(); return; }
    var sg = t.closest('[data-seg]');
    if (sg) {
      var n = sg.getAttribute('data-seg'), v = sg.getAttribute('data-v');
      if (n === 'sizing') { this.save({ sizing: v }); return; }
      this.f[n] = v; this.render(); return;
    }
    var rt = t.closest('[data-retry]'); if (rt) { E.undrop(rt.getAttribute('data-retry')); E.note(rt.getAttribute('data-retry'), 'Back in the follower list.', 'info'); return; }
    var a = t.closest('[data-act]'); if (!a) return;
    var act = a.getAttribute('data-act');
    if (act === 'min') this.root.classList.add('min');
    else if (act === 'settings') this.openSettings();
    else if (act === 'buy' || act === 'sell') this.order(act === 'buy');
    else if (act === 'be' || act === 'closeall' || act === 'cancelall') this.allAction(act);
    else if (act === 'clearlog') { E.log = []; this.refresh(); }
    else if (act === 'savelink') {
      var inp = this.root.querySelector('#zv-link'), h = this.root.querySelector('#zv-link-h'), sec = C.parseLevelsLink(inp.value);
      if (!inp.value.trim()) { this.host.setLink(null).then(function () { h.textContent = 'Link removed.'; self.L.reload(); self.refresh(); }); return; }
      if (!sec) { h.textContent = 'That does not look like a TradeZoro levels link.'; h.className = 'hint err'; return; }
      this.host.setLink(sec).then(function () { inp.value = ''; h.textContent = 'Saved. Levels load for SPX, NDX, SPY and QQQ.'; h.className = 'hint'; self.L.reload(); self.poll(); });
    }
  };
  P.input = function (e) {
    var k = e.target.getAttribute('data-f'); if (!k) return;
    this.f[k] = e.target.value; this.up_trade();
  };
  P.change = function (e) {
    var E = this.E, t = e.target, k = t.getAttribute('data-set');
    if (k === 'confirm') { this.confirm = t.checked; this.win.sessionStorage.setItem(SS_CONFIRM, t.checked ? 'on' : 'off'); E.note(null, t.checked ? 'Confirm step is on.' : 'Confirm step is off for this visit.', t.checked ? 'info' : 'warn'); }
    else if (k === 'copy') E.setCopy(t.checked);
    else if (k === 'mirror') this.save({ mirrorVestForm: t.checked });
    else if (k === 'showLevels') { this.save({ showLevels: t.checked }); this.poll(); }
    else if (k === 'master') { if (E.copyOn) E.setCopy(false); this.save({ master: t.value || null, followers: E.settings.followers.filter(function (f) { return f !== t.value; }) }); }
    var fo = t.getAttribute('data-fol');
    if (fo) {
      var list = E.settings.followers.filter(function (x) { return x !== fo; });
      if (t.checked) {
        if (list.length >= E.settings.maxFollowers) { t.checked = false; E.note(null, 'Follower limit is ' + E.settings.maxFollowers + '. Change it in Settings.', 'warn'); return; }
        list.push(fo);
      }
      this.save({ followers: list });
    }
    this.refresh();
  };

  root.ZV_UI = UI;
  root.ZV_VERSION = VERSION;
})(typeof globalThis !== 'undefined' ? globalThis : this);

// ---- boot.js
// Zoro for Vest: start-up inside Vest's page. Hooks go in at document_start (before Vest's own code runs) so the panel sees the
// session; the panel mounts once the page has a body. `host` gives levels (and saving the levels link) without exposing the link here.
(function (root) {
  'use strict';
  root.ZV_boot = function (win, host, assets) {
    if (win.__zoroForVest) return win.__zoroForVest;
    var E = new root.ZV_Engine(win, {});
    var L = new root.ZV_Levels(win, host, function () { if (ui) ui.refresh(); }, function (sym) { return E.marks[sym]; });
    var ui = null;
    var go = function () {
      if (ui || !win.document.body) return;
      ui = new root.ZV_UI(win, E, L, host, assets);
      ui.mount();
      E.start();
    };
    if (win.document.readyState === 'loading') win.document.addEventListener('DOMContentLoaded', go); else go();
    win.__zoroForVest = { version: root.ZV_VERSION };   // nothing reachable from here: no engine, no tokens
    return win.__zoroForVest;
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);

// ---- userscript/host.js
// Tampermonkey host: the levels link lives in Tampermonkey's own storage (GM_setValue), the request goes out through
// GM_xmlhttpRequest to tradezoro.com only (@connect). Vest's page never sees the link.
(function () {
  'use strict';
  var C = globalThis.ZV_CORE;
  var W = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
  function get(url) {
    return new Promise(function (ok) {
      GM_xmlhttpRequest({ method: 'GET', url: url, anonymous: true, timeout: 15000, headers: { Accept: 'application/json' },
        onload: function (r) { ok(r); }, onerror: function () { ok({ status: 0 }); }, ontimeout: function () { ok({ status: 0 }); } });
    });
  }
  var host = {
    levels: function (u) {
      var secret = GM_getValue('lvSecret', null);
      if (!secret) return Promise.resolve({ status: 'nolink', hasLink: false });
      var url = C.levelsUrl(secret, u);
      if (!url) return Promise.resolve({ status: 'error', error: 'No levels for this market.', hasLink: true });
      return get(url).then(function (r) {
        if (r.status === 404) return { status: 'inactive', hasLink: true };
        if (r.status === 429) return { status: 'error', error: 'Too many levels requests. Try again in a minute.', hasLink: true };
        if (r.status !== 200) return { status: 'error', error: r.status ? 'Levels feed answered ' + r.status + '.' : 'Levels could not be loaded.', hasLink: true };
        try { return { status: 'ok', json: JSON.parse(r.responseText), hasLink: true }; } catch (e) { return { status: 'error', error: 'Levels answer was not readable.', hasLink: true }; }
      });
    },
    setLink: function (secret) {
      if (secret && !/^[A-Za-z0-9_-]{43}$/.test(secret)) return Promise.resolve({ status: 'error' });
      if (secret) GM_setValue('lvSecret', secret); else GM_deleteValue('lvSecret');
      return Promise.resolve({ status: 'ok' });
    },
  };
  globalThis.ZV_boot(W, host, globalThis.ZV_ASSETS);
})();

})(Object.create(null));
