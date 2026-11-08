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
