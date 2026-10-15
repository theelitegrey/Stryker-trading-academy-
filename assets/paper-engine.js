/**
 * TradeZoro — Paper trading engine (pure logic, no DOM, no network)
 *
 * Owner order 2026-10-12: "Add complete full demo/paper trading feature inside the charts, like
 * tradingview". SIMULATED trading with demo money only. This file holds the account (balance,
 * net positions per symbol, working orders, brackets, history) and the fill rules. It never
 * talks to a broker and has no way to: it makes no network calls at all. The Charts page
 * (assets/chart-paper.js) feeds it prices from the bars the chart already receives and saves
 * its JSON state.
 *
 * Runs in Node for tests (module.exports, tools/tests/paper-engine.test.js) and in the browser
 * (window.PaperEngine). Depends on assets/replay-engine.js (window.ReplayEngine / require):
 *
 * FILL MODEL = the backtest replay's conservative model, reused (not re-implemented):
 *   - limit / stop entries fill when a price segment touches the order price; if the segment
 *     GAPS through it, the fill is the segment's open (worse), never the order price
 *     (ReplayEngine.Simulator.prototype._fillPrice);
 *   - stop-loss / take-profit are checked on every segment; if one segment touches both, the
 *     stop-loss is assumed first (ReplayEngine.Simulator.prototype._exitCheck, ambiguous 'sl');
 *   - an order that fills in a segment is checked against that same segment's bracket.
 *   On top of that, for live paper trading:
 *   - market orders fill at the last price plus `slippage` ticks against you; stop entries and
 *     stop-loss exits get the same slippage (they become market orders), limits and take-profit
 *     do not;
 *   - no fills while the market is closed (isOpen(symbol, t) from the caller, CME calendar for
 *     futures, always open for crypto): market orders are rejected, working orders wait;
 *   - brackets are OCO: TP and SL belong to the net position, so when one fills the position is
 *     flat and the other leg is gone with it.
 *
 * Positions are NET per symbol (like TradingView's paper account): a same-side fill adds and
 * averages the price, an opposite-side fill reduces, closes or flips the position.
 * P&L = (exit - entry) x qty x point value (futures contract point values; crypto per unit).
 * Commission = `commission` dollars per contract (or unit) per side, charged on every fill.
 *
 * REVIEW FIELDS (Trade review + leaderboard, Owner order 2026-10-14): every position also keeps
 *   sl0  the FIRST stop loss it had (the risk the trade was taken with; R = pnl / risk at sl0),
 *   hi / lo  the best and worst price seen while it was open (from the same segments the fills use;
 *        the exit segment only counts up to the exit price), for MAE / MFE,
 *   bal0 / maxQty  the balance when it opened and its largest size, for the leverage flag;
 * and every closed trade carries sl0, mae, mfe (price distance, >= 0), lev (largest notional /
 * balance at open), run (the account's resetAt: a reset starts a new run) and src ('replay' for
 * the bar-replay account, set through deps.source). Old trades without them still load.
 *
 * Education only. Not financial advice.
 */
(function (root, factory) {
  const RE = (typeof module !== 'undefined' && module.exports && typeof require === 'function')
    ? require('./replay-engine.js') : root.ReplayEngine;
  const api = factory(RE);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.PaperEngine = api;
})(typeof window !== 'undefined' ? window : globalThis, function (RE) {
  'use strict';

  if (!RE || !RE.Simulator) throw new Error('PaperEngine needs assets/replay-engine.js loaded first');
  const SIM = RE.Simulator.prototype;
  const roundTick = RE.roundTick;
  // the replay engine's own fill rules (neither touches simulator state beyond `ambiguous`)
  const fillPriceOf = (o, seg) => SIM._fillPrice.call(null, o, seg);
  const exitOf = (p, seg) => SIM._exitCheck.call({ ambiguous: 'sl' }, p, seg);

  const VERSION = 1;
  const DEFAULT_BALANCE = 100000;
  const MIN_BALANCE = 1000, MAX_BALANCE = 100000000;
  const MAX_ORDERS = 100, MAX_TRADES = 250, MAX_HISTORY = 250;

  // root: [tick, point value $]. Point values per the Owner brief (NQ $20, MNQ $2, ES $50, MES $5,
  // YM $5, MYM $0.5, GC $100, MGC $10, SI $5000, SIL $1000, CL $1000, MCL $100, RTY $50, M2K $5);
  // ticks mirror assets/chart-futures-provider.js.
  const FUTURES = {
    NQ: [0.25, 20], MNQ: [0.25, 2], ES: [0.25, 50], MES: [0.25, 5], YM: [1, 5], MYM: [1, 0.5],
    RTY: [0.1, 50], M2K: [0.1, 5], GC: [0.1, 100], MGC: [0.1, 10], SI: [0.005, 5000], SIL: [0.005, 1000],
    CL: [0.01, 1000], MCL: [0.01, 100], NG: [0.001, 10000], HG: [0.0005, 25000], MHG: [0.0005, 2500],
    ZN: [0.015625, 1000], ZB: [0.03125, 1000], '6E': [0.00005, 125000]
  };
  const CRYPTO_PROVIDERS = ['binance', 'coinbase', 'hyperliquid'];
  const FUTURES_PREFIXES = ['futures', 'rithmic', 'cme', 'cme_mini', 'cbot', 'cbot_mini', 'comex', 'comex_mini', 'nymex', 'nymex_mini'];

  function round2(n) { return Math.round(n * 100) / 100; }
  function decimalsOf(t) { const s = String(t); if (/e-/.test(s)) return Number(s.split('e-')[1]); const i = s.indexOf('.'); return i < 0 ? 0 : s.length - i - 1; }
  function num(v) { if (v === null || v === undefined || v === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null; }

  function splitSymbol(symbol) {
    const raw = String(symbol || '').trim();
    const i = raw.lastIndexOf(':');
    if (i > 0) return { raw, prefix: raw.slice(0, i).toLowerCase(), ticker: raw.slice(i + 1).toUpperCase() };
    return { raw, prefix: '', ticker: raw.toUpperCase() };
  }
  function futuresRootOf(ticker) {
    return String(ticker || '').toUpperCase().replace(/(?:[12]!)$/, '');
  }
  function futuresSpec(root, source) {
    const r = futuresRootOf(root);
    const f = FUTURES[r];
    if (!f) return { ok: false, reason: 'Paper trading does not cover futures root ' + (r || String(source || root).toUpperCase()) + ' yet.' };
    return { ok: true, symbol: 'futures:' + r + '1!', kind: 'futures', root: r, tick: f[0], pointValue: f[1], qtyStep: 1, minQty: 1, maxQty: 500, decimals: decimalsOf(f[0]) };
  }

  /**
   * Contract spec for a chart symbol ("futures:NQ1!", "CME_MINI:NQ1!", "NQ1!", "binance:BTCUSDT").
   * Futures are canonicalised to "futures:ROOT1!" so positions/orders from exchange-prefixed,
   * Rithmic-style or bare ids share one paper position. tickHint = chart minimum tick (crypto).
   */
  function specOf(symbol, tickHint) {
    const parts = splitSymbol(symbol);
    if (!parts.raw) return { ok: false, reason: 'Pick a symbol on the chart first.' };
    const prov = parts.prefix, ticker = parts.ticker;
    if ((!prov && /^[A-Z0-9]+(?:[12]!)?$/.test(ticker)) || FUTURES_PREFIXES.indexOf(prov) >= 0) {
      return futuresSpec(ticker, ticker);
    }
    if (CRYPTO_PROVIDERS.indexOf(prov) >= 0) {
      // P&L is in the quote currency, so only USD-quoted pairs (USDT / USDC / USD) are allowed.
      const usd = /(USDT|USDC|USD|FDUSD)$/.test(ticker.replace(/[-_/]/g, '')) || prov === 'hyperliquid';
      if (!usd) return { ok: false, reason: 'Paper trading covers USD-quoted crypto pairs only (P&L is in USD).' };
      const tick = Number(tickHint) > 0 ? Number(tickHint) : 0.01;
      return { ok: true, symbol: prov + ':' + ticker, kind: 'crypto', root: ticker, tick, pointValue: 1, qtyStep: 0.0001, minQty: 0.0001, maxQty: 1000000, decimals: decimalsOf(tick) };
    }
    return { ok: false, reason: 'Paper trading covers futures and USD-quoted crypto. ' + (ticker || parts.raw) + ' is not supported.' };
  }

  function defaultSettings() {
    // enabled: the member's "Enable paper trading" switch (Charts settings). OFF by default, also for
    // accounts saved before the switch existed (Owner order 2026-10-14): they must switch it on.
    return { enabled: false, commission: 0, slippage: 0, oneClick: true, lines: true, sounds: true, askJournal: true, qty: {} };
  }

  function freshState(balance, settings, now) {
    const b = Number(balance);
    const start = Number.isFinite(b) && b >= MIN_BALANCE && b <= MAX_BALANCE ? round2(b) : DEFAULT_BALANCE;
    return {
      v: VERSION, currency: 'USD', startBalance: start, balance: start, realized: 0, fees: 0,
      createdAt: now, resetAt: now, settings: Object.assign(defaultSettings(), settings || {}),
      positions: {}, orders: [], history: [], trades: [], nextId: 1, savedAt: now
    };
  }

  // Load-time hardening: whatever comes back from localStorage / Firestore is reshaped into a
  // valid state (a hand-edited or truncated copy must not crash the page).
  function sanitize(raw, now) {
    if (!raw || typeof raw !== 'object' || raw.v !== VERSION) return freshState(DEFAULT_BALANCE, null, now);
    const st = freshState(raw.startBalance, null, num(raw.createdAt) || now);
    st.balance = num(raw.balance) != null ? round2(raw.balance) : st.startBalance;
    st.realized = num(raw.realized) || 0; st.fees = num(raw.fees) || 0;
    st.resetAt = num(raw.resetAt) || st.createdAt; st.savedAt = num(raw.savedAt) || 0;
    const rs = raw.settings || {};
    st.settings = {
      enabled: rs.enabled === true,
      commission: Math.max(0, Math.min(100, num(rs.commission) || 0)),
      slippage: Math.max(0, Math.min(50, Math.round(num(rs.slippage) || 0))),
      oneClick: rs.oneClick !== false, lines: rs.lines !== false, sounds: rs.sounds !== false, askJournal: rs.askJournal !== false,
      qty: {}
    };
    if (rs.qty && typeof rs.qty === 'object') for (const k of Object.keys(rs.qty).slice(0, 100)) { const q = num(rs.qty[k]); if (q > 0) st.settings.qty[String(k).slice(0, 60)] = q; }
    const side = (v) => (v === 'sell' ? 'sell' : 'buy');
    if (raw.positions && typeof raw.positions === 'object') {
      for (const k of Object.keys(raw.positions).slice(0, 100)) {
        const p = raw.positions[k]; const sp = specOf(k); if (!p || !sp.ok) continue;
        const qty = num(p.qty), avg = num(p.avg); if (!(qty > 0) || !(avg > 0)) continue;
        const sym = sp.symbol;
        st.positions[sym] = { symbol: sym, side: side(p.side), qty, avg, sl: num(p.sl), tp: num(p.tp), openedAt: num(p.openedAt) || now, fees: num(p.fees) || 0,
          sl0: num(p.sl0) != null ? num(p.sl0) : num(p.sl), hi: num(p.hi) || avg, lo: num(p.lo) || avg, bal0: num(p.bal0), maxQty: Math.max(qty, num(p.maxQty) || 0) };
      }
    }
    if (Array.isArray(raw.orders)) {
      for (const o of raw.orders.slice(0, MAX_ORDERS)) {
        const sp = specOf(o && o.symbol);
        if (!o || !sp.ok || (o.type !== 'limit' && o.type !== 'stop')) continue;
        const qty = num(o.qty), price = num(o.price); if (!(qty > 0) || !(price > 0)) continue;
        st.orders.push({ id: num(o.id) || 0, symbol: sp.symbol, side: side(o.side), type: o.type, qty, price, sl: num(o.sl), tp: num(o.tp), placedAt: num(o.placedAt) || now });
      }
    }
    if (Array.isArray(raw.trades)) st.trades = raw.trades.filter((t) => t && typeof t === 'object' && num(t.pnl) != null).slice(-MAX_TRADES);
    if (Array.isArray(raw.history)) st.history = raw.history.filter((h) => h && typeof h === 'object').slice(-MAX_HISTORY);
    let maxId = 0;
    for (const o of st.orders) maxId = Math.max(maxId, o.id);
    for (const t of st.trades) maxId = Math.max(maxId, num(t.id) || 0);
    for (const h of st.history) maxId = Math.max(maxId, num(h.id) || 0);
    st.nextId = Math.max(num(raw.nextId) || 1, maxId + 1);
    return st;
  }

  class PaperAccount {
    /**
     * deps: { now(): ms, isOpen(symbol, ms): bool, tickOf(symbol): number|undefined }
     */
    constructor(state, deps) {
      this.deps = Object.assign({ now: () => Date.now(), isOpen: () => true, tickOf: () => undefined, source: '' }, deps || {});
      this.state = sanitize(state, this.deps.now());
      this.last = {};        // symbol -> last price seen (not persisted)
    }
    static fresh(balance, deps) { const a = new PaperAccount(null, deps); a.state = freshState(balance, null, a.deps.now()); return a; }
    toJSON() { return this.state; }
    get settings() { return this.state.settings; }
    spec(symbol) { return specOf(symbol, this.deps.tickOf(symbol)); }
    setLast(symbol, price) {
      if (!(Number(price) > 0)) return;
      const raw = String(symbol || ''), sp = this.spec(raw);
      let px = Number(price);
      if (sp.ok && sp.kind === 'futures' && sp.tick > 0) px = roundTick(px, sp.tick);   // futures only trade on the tick
      this.last[raw] = px;
      if (sp.ok) this.last[sp.symbol] = px;
    }
    position(symbol) { const sp = this.spec(symbol); return this.state.positions[sp.ok ? sp.symbol : symbol] || null; }

    // ---- money ----
    openPnl(p, price) {
      const px = price != null ? price : this.last[p.symbol];
      if (!(px > 0)) return 0;
      const spec = this.spec(p.symbol); if (!spec.ok) return 0;
      return round2((px - p.avg) * p.qty * spec.pointValue * (p.side === 'buy' ? 1 : -1));
    }
    summary(dayStartMs) {
      let unrealized = 0;
      for (const k of Object.keys(this.state.positions)) unrealized += this.openPnl(this.state.positions[k]);
      unrealized = round2(unrealized);
      const day = dayStartMs != null ? dayStartMs : 0;
      let dayPnl = 0;
      for (const t of this.state.trades) if (t.exitAt >= day) dayPnl += t.pnl;
      return {
        currency: 'USD', startBalance: this.state.startBalance, balance: round2(this.state.balance),
        equity: round2(this.state.balance + unrealized), unrealized, realized: round2(this.state.realized),
        dayPnl: round2(dayPnl), fees: round2(this.state.fees), trades: this.state.trades.length,
        positions: Object.keys(this.state.positions).length, orders: this.state.orders.length
      };
    }
    // $ at the order's bracket for display (positive = profit)
    bracketValue(symbol, side, qty, entry, level) {
      const spec = this.spec(symbol); if (!spec.ok || level == null || !(entry > 0)) return null;
      return round2((level - entry) * qty * spec.pointValue * (side === 'buy' ? 1 : -1));
    }

    // ---- orders ----
    /**
     * o: { symbol, side, type: market|limit|stop, qty, price (limit/stop), sl, tp }
     * Returns { order } for a working order or { events } for a market fill. Throws Error with a
     * member-facing message when the order is rejected (a rejected market order is also logged).
     */
    placeOrder(o) {
      const now = this.deps.now();
      let symbol = String(o.symbol || '');
      const spec = this.spec(symbol);
      if (!spec.ok) throw new Error(spec.reason);
      symbol = spec.symbol;
      const side = o.side === 'sell' ? 'sell' : 'buy';
      const type = o.type === 'limit' || o.type === 'stop' ? o.type : 'market';
      const qty = this._qty(spec, o.qty);
      const dir = side === 'buy' ? 1 : -1;
      // A blown account can still close / reduce what it holds (and its brackets still fill);
      // only orders that open or add exposure are refused.
      const held = this.state.positions[symbol];
      const reducing = type === 'market' && held && held.side !== side && qty <= held.qty;
      if (this.state.balance <= 0 && !reducing) throw new Error('This paper account has no balance left. Reset it to keep practising.');
      const last = this.last[symbol] || this.last[spec.symbol];
      if (!(last > 0)) throw new Error('No price yet for ' + this._name(symbol) + '. Open it on a chart and wait for the price.');
      if (type === 'market' && !this.deps.isOpen(symbol, now)) {
        this._hist({ kind: 'reject', symbol, side, type, qty, note: 'Market closed' });
        throw new Error('Market closed for ' + this._name(symbol) + '. Market orders are rejected until it reopens; limit and stop orders can wait.');
      }
      const ref = type === 'market' ? last : roundTick(Number(o.price), spec.tick);
      if (type !== 'market' && !(ref > 0)) throw new Error('Enter an order price.');
      if (type === 'limit' && !((ref - last) * dir < 0)) throw new Error(side === 'buy' ? 'A buy limit must sit below the current price (use a buy stop above it).' : 'A sell limit must sit above the current price (use a sell stop below it).');
      if (type === 'stop' && !((ref - last) * dir > 0)) throw new Error(side === 'buy' ? 'A buy stop must sit above the current price (use a buy limit below it).' : 'A sell stop must sit below the current price (use a sell limit above it).');
      const sl = num(o.sl) != null ? roundTick(num(o.sl), spec.tick) : null;
      const tp = num(o.tp) != null ? roundTick(num(o.tp), spec.tick) : null;
      this._checkBracket(side, ref, sl, tp);
      if (type === 'market') {
        const fill = roundTick(last + dir * this.state.settings.slippage * spec.tick, spec.tick);
        return { events: this._fill({ id: this.state.nextId++, symbol, side, type, qty, sl, tp }, fill, now) };
      }
      if (this.state.orders.length >= MAX_ORDERS) throw new Error('You have ' + MAX_ORDERS + ' working orders, the most we keep. Cancel one first.');
      const order = { id: this.state.nextId++, symbol, side, type, qty, price: ref, sl, tp, placedAt: now };
      this.state.orders.push(order);
      return { order };
    }
    cancelOrder(id, note) {
      const i = this.state.orders.findIndex((x) => x.id === id);
      if (i < 0) return null;
      const o = this.state.orders.splice(i, 1)[0];
      this._hist({ kind: 'cancel', symbol: o.symbol, side: o.side, type: o.type, qty: o.qty, price: o.price, note: note || '' });
      return o;
    }
    cancelAll(symbol) { for (const o of this.state.orders.slice()) if (!symbol || o.symbol === symbol) this.cancelOrder(o.id); }
    modifyOrder(id, ch) {
      const o = this.state.orders.find((x) => x.id === id);
      if (!o) throw new Error('That order is no longer working.');
      const spec = this.spec(o.symbol);
      const next = Object.assign({}, o);
      if (ch.price != null) next.price = roundTick(Number(ch.price), spec.tick);
      if (ch.qty != null) next.qty = this._qty(spec, ch.qty);
      if ('sl' in ch) next.sl = num(ch.sl) != null ? roundTick(num(ch.sl), spec.tick) : null;
      if ('tp' in ch) next.tp = num(ch.tp) != null ? roundTick(num(ch.tp), spec.tick) : null;
      const last = this.last[o.symbol], dir = o.side === 'buy' ? 1 : -1;
      if (last > 0 && ch.price != null) {
        if (o.type === 'limit' && !((next.price - last) * dir < 0)) throw new Error(o.side === 'buy' ? 'A buy limit must stay below the current price.' : 'A sell limit must stay above the current price.');
        if (o.type === 'stop' && !((next.price - last) * dir > 0)) throw new Error(o.side === 'buy' ? 'A buy stop must stay above the current price.' : 'A sell stop must stay below the current price.');
      }
      // moving the entry drags the bracket with it, like dragging a TradingView order line
      if (ch.price != null && ch.keepBracket !== false && !('sl' in ch) && !('tp' in ch)) {
        const d = next.price - o.price;
        if (o.sl != null) next.sl = roundTick(o.sl + d, spec.tick);
        if (o.tp != null) next.tp = roundTick(o.tp + d, spec.tick);
      }
      this._checkBracket(o.side, next.price, next.sl, next.tp);
      Object.assign(o, next);
      return o;
    }
    modifyPosition(symbol, ch) {
      const spec = this.spec(symbol), sym = spec.ok ? spec.symbol : symbol;
      const p = this.state.positions[sym];
      if (!p) throw new Error('That position is closed.');
      const dir = p.side === 'buy' ? 1 : -1;
      const last = this.last[sym] || this.last[symbol] || p.avg;
      let sl = p.sl, tp = p.tp;
      if ('sl' in ch) sl = num(ch.sl) != null ? roundTick(num(ch.sl), spec.tick) : null;
      if ('tp' in ch) tp = num(ch.tp) != null ? roundTick(num(ch.tp), spec.tick) : null;
      if ('sl' in ch && sl != null && !((sl - last) * dir < 0)) throw new Error(p.side === 'buy' ? 'The stop loss must be below the current price.' : 'The stop loss must be above the current price.');
      if ('tp' in ch && tp != null && !((tp - last) * dir > 0)) throw new Error(p.side === 'buy' ? 'The take profit must be above the current price.' : 'The take profit must be below the current price.');
      p.sl = sl; p.tp = tp;
      if (p.sl0 == null && sl != null) p.sl0 = sl;     // a stop added after the fill is the trade's risk
      return p;
    }
    /** Close all (or qty) of a position at market. */
    closePosition(symbol, qty) {
      const spec = this.spec(symbol), sym = spec.ok ? spec.symbol : symbol;
      const p = this.state.positions[sym];
      if (!p) throw new Error('That position is already closed.');
      const q = num(qty) > 0 && num(qty) < p.qty ? num(qty) : p.qty;
      return this.placeOrder({ symbol: sym, side: p.side === 'buy' ? 'sell' : 'buy', type: 'market', qty: q, _close: true }).events;
    }
    /** Flip a position: one market order for twice the size. */
    reversePosition(symbol) {
      const spec = this.spec(symbol), sym = spec.ok ? spec.symbol : symbol;
      const p = this.state.positions[sym];
      if (!p) throw new Error('That position is already closed.');
      return this.placeOrder({ symbol: sym, side: p.side === 'buy' ? 'sell' : 'buy', type: 'market', qty: p.qty * 2 }).events;
    }
    /** Close every position (markets that are open) and cancel every working order. */
    flattenAll() {
      const events = [], skipped = [];
      for (const k of Object.keys(this.state.positions)) {
        try { events.push(...this.closePosition(k)); } catch (e) { skipped.push({ symbol: k, reason: e.message }); }
      }
      this.cancelAll();
      return { events, skipped };
    }
    reset(balance) {
      const settings = this.state.settings;
      this.state = freshState(balance, settings, this.deps.now());
      this._hist({ kind: 'reset', note: 'Account reset to ' + this.state.startBalance });
    }
    setSettings(ch) {
      const s = this.state.settings;
      if (ch.commission != null) s.commission = Math.max(0, Math.min(100, Number(ch.commission) || 0));
      if (ch.slippage != null) s.slippage = Math.max(0, Math.min(50, Math.round(Number(ch.slippage) || 0)));
      for (const k of ['enabled', 'oneClick', 'lines', 'sounds', 'askJournal']) if (k in ch) s[k] = !!ch[k];
      return s;
    }
    setQty(symbol, qty) { const spec = this.spec(symbol); if (!spec.ok) return; try { this.state.settings.qty[spec.symbol] = this._qty(spec, qty); } catch (e) {} }
    qtyFor(symbol) { const spec = this.spec(symbol); const q = this.state.settings.qty[spec.ok ? spec.symbol : symbol]; return q > 0 ? q : (spec.ok ? spec.minQty * (spec.kind === 'crypto' ? 100 : 1) : 1); }
    markJournaled(tradeId) { const t = this.state.trades.find((x) => x.id === tradeId); if (t) t.journaled = true; return t; }

    // ---- live feed ----
    /**
     * One price segment for a symbol: { t, o, h, l, c } covering what traded since the last
     * segment (see chart-paper.js). Returns the fill / exit events it caused.
     */
    onSegment(symbol, seg) {
      if (!seg || !(seg.c > 0)) return [];
      const events = [];
      const now = this.deps.now();
      const raw = String(symbol || ''), spec = this.spec(raw);
      if (!spec.ok) return events;
      symbol = spec.symbol;
      if (!this.deps.isOpen(symbol, seg.t != null ? seg.t : now) && !this.deps.isOpen(symbol, now)) { this.setLast(raw, seg.c); return events; }
      const slip = this.state.settings.slippage * spec.tick;
      const before = this.state.positions[symbol];   // only a position open BEFORE this segment saw its whole range
      for (const o of this.state.orders.slice()) {
        if (o.symbol !== symbol) continue;
        let fp = fillPriceOf(o, seg);
        if (fp == null) continue;
        if (o.type === 'stop') fp += (o.side === 'buy' ? 1 : -1) * slip;
        this.state.orders.splice(this.state.orders.indexOf(o), 1);
        events.push(...this._fill(o, roundTick(fp, spec.tick), seg.t != null ? seg.t : now));
      }
      const p = this.state.positions[symbol];
      let exited = false;
      if (p && (p.sl != null || p.tp != null)) {
        const ex = exitOf(p, seg);
        if (ex) {
          exited = true;
          let px = ex.price;
          if (ex.reason === 'sl') px -= (p.side === 'buy' ? 1 : -1) * slip;
          events.push(...this._fill({ id: this.state.nextId++, symbol, side: p.side === 'buy' ? 'sell' : 'buy', type: ex.reason, qty: p.qty, sl: null, tp: null }, roundTick(px, spec.tick), seg.t != null ? seg.t : now, ex.reason));
        }
      }
      // excursion: a position still open after this segment saw its whole range
      const still = this.state.positions[symbol];
      if (still && !exited && still === p && p === before) { still.hi = Math.max(num(still.hi) || still.avg, seg.h); still.lo = Math.min(num(still.lo) || still.avg, seg.l); }
      this.setLast(symbol, seg.c);
      return events;
    }

    // ---- internals ----
    _name(symbol) { return String(symbol).replace(/^[^:]+:/, ''); }
    _qty(spec, v) {
      const q = Number(v);
      if (!(q > 0)) throw new Error('Quantity must be greater than zero.');
      const steps = Math.round(q / spec.qtyStep);
      const qq = Number((steps * spec.qtyStep).toFixed(6));
      if (qq < spec.minQty) throw new Error('The smallest size is ' + spec.minQty + (spec.kind === 'futures' ? ' contract.' : '.'));
      if (qq > spec.maxQty) throw new Error('The largest paper order is ' + spec.maxQty + (spec.kind === 'futures' ? ' contracts.' : ' units.'));
      return qq;
    }
    _checkBracket(side, ref, sl, tp) {
      const dir = side === 'buy' ? 1 : -1;
      if (sl != null && !((sl - ref) * dir < 0)) throw new Error(side === 'buy' ? 'The stop loss must be below the entry.' : 'The stop loss must be above the entry.');
      if (tp != null && !((tp - ref) * dir > 0)) throw new Error(side === 'buy' ? 'The take profit must be above the entry.' : 'The take profit must be below the entry.');
    }
    _hist(h) {
      this.state.history.push(Object.assign({ id: this.state.nextId++, at: this.deps.now() }, h));
      if (this.state.history.length > MAX_HISTORY) this.state.history.splice(0, this.state.history.length - MAX_HISTORY);
    }
    // Apply one fill to the net position. reason: 'tp' | 'sl' for bracket exits.
    _fill(order, price, t, reason) {
      const st = this.state, spec = this.spec(order.symbol), sym = order.symbol;
      const events = [];
      const fee = round2(st.settings.commission * order.qty);
      st.balance = round2(st.balance - fee); st.fees = round2(st.fees + fee);
      this._hist({ kind: 'fill', symbol: sym, side: order.side, type: order.type, qty: order.qty, price, orderId: order.id, note: reason ? (reason === 'tp' ? 'Take profit' : 'Stop loss') : '' });
      let p = st.positions[sym];
      if (!p) {
        p = st.positions[sym] = { symbol: sym, side: order.side, qty: order.qty, avg: price, sl: order.sl, tp: order.tp, openedAt: t, fees: fee,
          sl0: order.sl != null ? order.sl : null, hi: price, lo: price, bal0: round2(st.balance + fee), maxQty: order.qty };
        events.push({ type: 'open', symbol: sym, side: p.side, qty: p.qty, price, position: p });
        return events;
      }
      if (p.side === order.side) {
        const qty = Number((p.qty + order.qty).toFixed(6));
        p.avg = roundTick((p.avg * p.qty + price * order.qty) / qty, spec.tick / 100);
        p.qty = qty; p.fees = round2(p.fees + fee);
        p.maxQty = Math.max(num(p.maxQty) || 0, qty);
        p.hi = Math.max(num(p.hi) || price, price); p.lo = Math.min(num(p.lo) || price, price);
        if (order.sl != null) p.sl = order.sl;
        if (p.sl0 == null && order.sl != null) p.sl0 = order.sl;
        if (order.tp != null) p.tp = order.tp;
        events.push({ type: 'add', symbol: sym, side: p.side, qty: order.qty, price, position: p });
        return events;
      }
      // opposite side: reduce / close / flip
      const closeQty = Math.min(order.qty, p.qty);
      const rest = Number((order.qty - closeQty).toFixed(6));
      const dir = p.side === 'buy' ? 1 : -1;
      const gross = round2((price - p.avg) * closeQty * spec.pointValue * dir);
      const feeIn = round2(p.fees * (closeQty / p.qty));
      const feeOut = round2(st.settings.commission * closeQty);
      const pnl = round2(gross - feeIn - feeOut);
      st.balance = round2(st.balance + gross); st.realized = round2(st.realized + pnl);
      const hi = Math.max(num(p.hi) || p.avg, p.avg, price), lo = Math.min(num(p.lo) || p.avg, p.avg, price);
      const mfe = dir > 0 ? hi - p.avg : p.avg - lo, mae = dir > 0 ? p.avg - lo : hi - p.avg;
      const bal0 = num(p.bal0) > 0 ? p.bal0 : st.startBalance;
      const trade = { id: st.nextId++, symbol: sym, side: p.side, qty: closeQty, entry: p.avg, exit: price, entryAt: p.openedAt, exitAt: t,
        gross, fees: round2(feeIn + feeOut), pnl, reason: reason || (rest > 0 ? 'reverse' : 'manual'), sl: p.sl, tp: p.tp, pointValue: spec.pointValue, journaled: false,
        sl0: p.sl0 != null ? p.sl0 : (p.sl != null ? p.sl : null), mae: Math.max(0, roundTick(mae, spec.tick / 100)), mfe: Math.max(0, roundTick(mfe, spec.tick / 100)),
        lev: Math.round(p.avg * (num(p.maxQty) || p.qty) * spec.pointValue / bal0 * 100) / 100, run: st.resetAt };
      if (this.deps.source) trade.src = this.deps.source;
      st.trades.push(trade);
      if (st.trades.length > MAX_TRADES) st.trades.splice(0, st.trades.length - MAX_TRADES);
      if (closeQty < p.qty) {
        p.qty = Number((p.qty - closeQty).toFixed(6)); p.fees = round2(p.fees - feeIn);
        events.push({ type: 'reduce', symbol: sym, side: p.side, qty: closeQty, price, trade, position: p });
        return events;
      }
      delete st.positions[sym];
      events.push({ type: reason || 'close', symbol: sym, side: p.side, qty: closeQty, price, trade });
      if (rest > 0) {
        const np = st.positions[sym] = { symbol: sym, side: order.side, qty: rest, avg: price, sl: order.sl, tp: order.tp, openedAt: t, fees: round2(st.settings.commission * rest),
          sl0: order.sl != null ? order.sl : null, hi: price, lo: price, bal0: st.balance, maxQty: rest };
        events.push({ type: 'open', symbol: sym, side: np.side, qty: np.qty, price, position: np, reversed: true });
      }
      return events;
    }
  }

  return { VERSION, DEFAULT_BALANCE, MIN_BALANCE, MAX_BALANCE, FUTURES, specOf, freshState, sanitize, PaperAccount, round2, roundTick };
});
