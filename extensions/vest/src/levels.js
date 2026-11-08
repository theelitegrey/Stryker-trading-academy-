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
