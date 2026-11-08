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
