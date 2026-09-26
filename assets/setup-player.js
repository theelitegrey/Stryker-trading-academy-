// Stryker Trading Academy — interactive setup player (model.html)
//
// Plays a trading model's setup as a step-through chart animation: candles
// arrive, then the annotations the model cares about (liquidity, the sweep,
// the MSS, the FVG, entry / stop / target) are drawn in one frame at a time
// with a caption under the chart. Plain SVG built from strings, no library,
// nothing from a CDN.
//
// Depends on: nothing. Exposes window.mountSetupPlayer(slotEl, model) and
// window.SetupPlayer.validate(storyboard). model-reader.js calls
// mountSetupPlayer at the end of renderModel(); it is safe to call again on
// re-render (the previous instance is torn down first).
//
// ---------------------------------------------------------------------------
// STORYBOARD SCHEMA  (model.storyboard — optional; no storyboard = no player)
// ---------------------------------------------------------------------------
// Firestore cannot store arrays inside arrays, so candles are OBJECTS, not
// [o,h,l,c] tuples. Prices are in arbitrary units: the player never prints a
// price, and every storyboard is labelled "Illustrative example" on screen.
//
// {
//   version: 1,
//   title: "15m FVG continuation",     // shown above the chart
//   timeframe: "15m",                  // optional, shown next to the badge
//   candles: [ { o: 114, h: 116, l: 113, c: 115.5 }, ... ],   // 5..120 candles
//   frames: [                          // 1..30 frames, played in order
//     {
//       title:   "Mark the liquidity",       // short step name (optional)
//       caption: "Plain-text caption ...",   // what the student reads (plain text, never HTML)
//       reveal:  10,                         // candles visible in this frame (default: previous frame's; first frame: all)
//       add:     [ <annotation>, ... ],      // annotations that appear in this frame and stay after it
//       remove:  [ "id", ... ],              // annotation ids that disappear from this frame on
//       focus:   [ "id", ... ],              // optional: every OTHER annotation is dimmed in this frame
//       hold:    3200                        // optional ms at 1x before auto-advancing (default from caption length)
//     }
//   ]
// }
//
// Annotation types. Every annotation needs a unique "id". Candle positions
// are 0-based candle indices; "from"/"to" default to the first/last candle.
// "label" is optional plain text. "tone" is one of liq | bull | bear | neutral.
//   { type: "level",  id, price, from, to, label, tone }       dashed horizontal line (liquidity, old high/low)
//   { type: "zone",   id, top, bottom, from, to, label, tone } price box (order block, range)
//   { type: "fvg",    ...same as zone, tone defaults to bull } fair value gap box
//   { type: "band",   id, from, to, label }                    full-height time window (a killzone, the open)
//   { type: "sweep",  id, at, side: "high"|"low", label }      marker on the wick that ran the liquidity
//   { type: "mss",    id, price, from, to, label }             the broken swing, drawn to the breaking candle
//   { type: "entry" | "stop" | "target", id, price, from, to, label }   order lines
//   { type: "highlight", id, from, to }                         ring around candles (to defaults to from)
//   { type: "arrow",  id, from: {at, price}, to: {at, price}, label }   direction of delivery
//   { type: "note",   id, at, price, label }                    free text on the chart
// "labelSide": "left" | "right" moves a line/zone label to either end (default right).
//
// Behaviour: auto-plays when ~45% of the player is on screen, pauses off
// screen or in a background tab, plays through once and stops on the last
// frame. prefers-reduced-motion: never auto-plays and every step renders
// instantly with no tweening. Keyboard on the focused player: Left/Right
// step, Space play/pause, Home/End first/last. A horizontal swipe on the
// chart steps on phones. An invalid storyboard, or any error while building
// it, leaves the slot hidden: the article text is never touched.
// ---------------------------------------------------------------------------

(function () {
  'use strict';

  var MAX_CANDLES = 120, MAX_FRAMES = 30, MAX_ANN = 60;
  var TYPES = { level: 1, zone: 1, fvg: 1, band: 1, sweep: 1, mss: 1, entry: 1, stop: 1, target: 1, highlight: 1, arrow: 1, note: 1 };
  var TONES = { liq: 1, bull: 1, bear: 1, neutral: 1 };

  function reducedMotion() {
    try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; }
  }
  function num(v) { return typeof v === 'number' && isFinite(v); }
  function str(v, max) { return typeof v === 'string' ? v.slice(0, max || 400) : ''; }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function clampInt(v, lo, hi, dflt) {
    if (!num(v)) return dflt;
    v = Math.round(v); return v < lo ? lo : (v > hi ? hi : v);
  }

  // ---- validation ----------------------------------------------------------
  // Returns a cleaned copy, or null if the storyboard can't be played. Bad
  // individual annotations are dropped rather than failing the whole thing;
  // a bad candle fails the whole storyboard (the chart would lie otherwise).
  function validate(sb) {
    if (!sb || typeof sb !== 'object') return null;
    var rawC = sb.candles, rawF = sb.frames;
    if (!Array.isArray(rawC) || !Array.isArray(rawF)) return null;
    if (rawC.length < 5 || rawC.length > MAX_CANDLES || !rawF.length || rawF.length > MAX_FRAMES) return null;

    var candles = [];
    for (var i = 0; i < rawC.length; i++) {
      var k = rawC[i];
      if (!k || !num(k.o) || !num(k.h) || !num(k.l) || !num(k.c)) return null;
      if (k.h < Math.max(k.o, k.c) || k.l > Math.min(k.o, k.c)) return null;
      candles.push({ o: k.o, h: k.h, l: k.l, c: k.c });
    }
    var n = candles.length, last = n - 1;
    var ids = {}, annCount = 0;

    function cleanAnn(a) {
      if (!a || typeof a !== 'object' || !TYPES[a.type]) return null;
      var id = str(a.id, 60);
      if (!id || ids[id]) return null;
      var o = { type: a.type === 'fvg' ? 'zone' : a.type, id: id, label: str(a.label, 60) };
      o.tone = TONES[a.tone] ? a.tone : (a.type === 'fvg' ? 'bull' : (a.type === 'level' ? 'liq' : 'neutral'));
      o.labelSide = a.labelSide === 'left' ? 'left' : 'right';
      o.from = clampInt(a.from, 0, last, 0);
      o.to = clampInt(a.to, 0, last, last);
      if (o.to < o.from) { var t = o.to; o.to = o.from; o.from = t; }
      switch (o.type) {
        case 'level': case 'mss': case 'entry': case 'stop': case 'target':
          if (!num(a.price)) return null; o.price = a.price; break;
        case 'zone':
          if (!num(a.top) || !num(a.bottom)) return null;
          o.top = Math.max(a.top, a.bottom); o.bottom = Math.min(a.top, a.bottom); break;
        case 'band': break;
        case 'highlight':
          o.to = clampInt(a.to, 0, last, o.from); if (o.to < o.from) o.to = o.from; break;
        case 'sweep':
          o.at = clampInt(a.at, 0, last, -1); if (o.at < 0) return null;
          o.side = a.side === 'high' ? 'high' : 'low'; break;
        case 'note':
          o.at = clampInt(a.at, 0, last, -1); if (o.at < 0 || !num(a.price) || !o.label) return null;
          o.price = a.price; break;
        case 'arrow':
          if (!a.from || !a.to || !num(a.from.price) || !num(a.to.price)) return null;
          o.a = { at: clampInt(a.from.at, 0, last, 0), price: a.from.price };
          o.b = { at: clampInt(a.to.at, 0, last, last), price: a.to.price };
          break;
      }
      ids[id] = 1;
      return o;
    }

    var frames = [], prevReveal = n;
    for (var f = 0; f < rawF.length; f++) {
      var fr = rawF[f] || {};
      var reveal = clampInt(fr.reveal, 1, n, f === 0 ? n : prevReveal);
      var add = [];
      (Array.isArray(fr.add) ? fr.add : []).forEach(function (a) {
        if (annCount >= MAX_ANN) return;
        var c = cleanAnn(a); if (c) { add.push(c); annCount++; }
      });
      frames.push({
        title: str(fr.title, 80),
        caption: str(fr.caption, 600),
        reveal: reveal,
        add: add,
        remove: (Array.isArray(fr.remove) ? fr.remove : []).filter(function (x) { return typeof x === 'string'; }),
        focus: Array.isArray(fr.focus) ? fr.focus.filter(function (x) { return typeof x === 'string'; }) : null,
        hold: num(fr.hold) ? Math.max(800, Math.min(15000, fr.hold)) : 0
      });
      prevReveal = reveal;
    }
    return { title: str(sb.title, 100), timeframe: str(sb.timeframe, 12), candles: candles, frames: frames };
  }

  // Active annotations at frame k, in the order they were added.
  function activeAt(sb, k) {
    var list = [];
    for (var f = 0; f <= k; f++) {
      var fr = sb.frames[f];
      if (fr.remove.length) list = list.filter(function (it) { return fr.remove.indexOf(it.a.id) < 0; });
      fr.add.forEach(function (a) { list.push({ a: a, bornAt: f }); });
    }
    return list;
  }

  // ---- icons ---------------------------------------------------------------
  var IC = {
    prev: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M15 6l-6 6 6 6"/></svg>',
    next: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M9 6l6 6-6 6"/></svg>',
    play: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path class="sp-ifill" d="M8 5.5v13l11-6.5z"/></svg>',
    pause: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path class="sp-ifill" d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z"/></svg>',
    replay: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 12a8 8 0 1 0 2.4-5.7"/><path d="M4 4v4.5h4.5"/></svg>'
  };

  // ---- the player ----------------------------------------------------------
  function Player(slot, sb, modelName) {
    this.slot = slot; this.sb = sb; this.idx = 0;
    this.playing = false; this.autoPaused = false; this.userPaused = false;
    this.speed = 1; this.timer = null; this.visible = false; this.lastW = 0; this.drawn = false;
    this.reduced = reducedMotion();
    this.build(modelName);
  }

  Player.prototype.build = function (modelName) {
    var sb = this.sb, self = this, n = sb.frames.length;
    var title = sb.title || (modelName ? modelName + ' setup' : 'Setup walkthrough');
    var root = document.createElement('section');
    root.className = 'sp' + (this.reduced ? ' sp-still' : '');
    root.setAttribute('tabindex', '0');
    root.setAttribute('aria-roledescription', 'setup player');
    root.setAttribute('aria-label', 'Setup walkthrough: ' + title + '. Illustrative example. Left and right arrow keys step, space plays or pauses.');
    root.innerHTML =
      '<div class="sp-head">' +
        '<div class="sp-head-l"><span class="sp-kicker">Setup walkthrough</span><span class="sp-title"></span></div>' +
        '<div class="sp-head-r">' + (sb.timeframe ? '<span class="sp-tf"></span>' : '') +
          '<span class="sp-badge">Illustrative example</span></div>' +
      '</div>' +
      '<div class="sp-chart"></div>' +
      '<div class="sp-cap">' +
        '<div class="sp-cap-top"><span class="sp-stepno"></span><span class="sp-cap-title"></span></div>' +
        '<p class="sp-cap-text" aria-live="polite"></p>' +
      '</div>' +
      '<div class="sp-ctrls">' +
        '<button type="button" class="sp-btn sp-prev" aria-label="Previous step">' + IC.prev + '</button>' +
        '<button type="button" class="sp-btn sp-play" aria-label="Play">' + IC.play + '</button>' +
        '<button type="button" class="sp-btn sp-next" aria-label="Next step">' + IC.next + '</button>' +
        '<input type="range" class="sp-scrub" min="0" max="' + (n - 1) + '" step="1" value="0" aria-label="Setup step">' +
        '<div class="sp-speed" role="group" aria-label="Playback speed">' +
          '<button type="button" data-speed="0.5" aria-pressed="false" aria-label="Half speed">0.5x</button>' +
          '<button type="button" data-speed="1" aria-pressed="true" aria-label="Normal speed">1x</button>' +
          '<button type="button" data-speed="2" aria-pressed="false" aria-label="Double speed">2x</button>' +
        '</div>' +
      '</div>' +
      '<p class="sp-foot">Illustrative candles drawn to teach the pattern. Not real market data and not a trade record.</p>';
    root.querySelector('.sp-title').textContent = title;
    if (sb.timeframe) root.querySelector('.sp-tf').textContent = sb.timeframe;

    this.root = root;
    this.chart = root.querySelector('.sp-chart');
    this.elStep = root.querySelector('.sp-stepno');
    this.elCapTitle = root.querySelector('.sp-cap-title');
    this.elCap = root.querySelector('.sp-cap-text');
    this.btnPlay = root.querySelector('.sp-play');
    this.btnPrev = root.querySelector('.sp-prev');
    this.btnNext = root.querySelector('.sp-next');
    this.scrub = root.querySelector('.sp-scrub');

    this.btnPrev.addEventListener('click', function () { self.userStep(-1); });
    this.btnNext.addEventListener('click', function () { self.userStep(1); });
    this.btnPlay.addEventListener('click', function () { self.togglePlay(); });
    this.scrub.addEventListener('input', function () { self.stop(true); self.go(+self.scrub.value, false); });
    Array.prototype.forEach.call(root.querySelectorAll('.sp-speed button'), function (b) {
      b.addEventListener('click', function () { self.setSpeed(+b.getAttribute('data-speed')); });
    });

    root.addEventListener('keydown', function (e) {
      var t = e.target, tag = t && t.tagName;
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      if (tag === 'INPUT') return;                 // the scrubber handles its own arrow keys
      if (e.key === 'ArrowRight') { e.preventDefault(); self.userStep(1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); self.userStep(-1); }
      else if (e.key === 'Home') { e.preventDefault(); self.stop(true); self.go(0, false); }
      else if (e.key === 'End') { e.preventDefault(); self.stop(true); self.go(self.sb.frames.length - 1, false); }
      else if ((e.key === ' ' || e.key === 'Spacebar') && tag !== 'BUTTON') { e.preventDefault(); self.togglePlay(); }
    });

    // Swipe on the chart. touch-action: pan-y (CSS) keeps vertical page
    // scrolling native; only a clearly horizontal gesture steps.
    var sx = 0, sy = 0, st = 0;
    this.chart.addEventListener('touchstart', function (e) {
      if (e.touches.length !== 1) { st = 0; return; }
      sx = e.touches[0].clientX; sy = e.touches[0].clientY; st = 1;
    }, { passive: true });
    this.chart.addEventListener('touchend', function (e) {
      if (!st || !e.changedTouches.length) return;
      var dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy;
      st = 0;
      if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.4) self.userStep(dx < 0 ? 1 : -1);
    }, { passive: true });

    this.slot.innerHTML = '';
    this.slot.appendChild(root);
    this.slot.hidden = false;

    // Draw at the real pixel width, so labels stay readable at 390 instead of
    // shrinking with a viewBox. This also covers the reader being revealed
    // after the access check (width 0 -> real): the first draw happens then.
    if ('ResizeObserver' in window) {
      this.ro = new ResizeObserver(function () {
        var w = self.chart.clientWidth;
        if (w && Math.abs(w - self.lastW) > 1) self.draw(false);
      });
      this.ro.observe(this.chart);
    } else {
      this.onResize = function () { self.draw(false); };
      window.addEventListener('resize', this.onResize);
    }

    if ('IntersectionObserver' in window) {
      this.io = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          // "In view" = 45% of the player visible, OR the player filling 60%
          // of the viewport (a tall player on a short phone screen can never
          // reach 45% of itself).
          var vh = (en.rootBounds && en.rootBounds.height) || window.innerHeight || 1;
          self.visible = en.isIntersecting &&
            (en.intersectionRatio >= 0.45 || en.intersectionRect.height >= vh * 0.6);
          if (self.visible) self.maybeAutoPlay();
          else if (self.playing) { self.stop(false); self.autoPaused = true; }
        });
      }, { threshold: [0, 0.2, 0.3, 0.45, 0.6, 0.8, 1] });
      this.io.observe(root);
    }

    // Autoplay is held back while the reader is .gate-pending (access check
    // running) or .paywall-dimmed. When that class is lifted the player has
    // not moved, so the IntersectionObserver never fires again; without this
    // a player scrolled into view during the access check sat on step 1.
    var shell = this.slot.closest && this.slot.closest('.reader-shell');
    if (shell && 'MutationObserver' in window) {
      this.mo = new MutationObserver(function () { self.maybeAutoPlay(); });
      this.mo.observe(shell, { attributes: true, attributeFilter: ['class'] });
    }
    this.onVis = function () {
      if (document.hidden && self.playing) { self.stop(false); self.autoPaused = true; }
      else if (!document.hidden) self.maybeAutoPlay();
    };
    document.addEventListener('visibilitychange', this.onVis);

    this.go(0, false);
  };

  Player.prototype.destroy = function () {
    this.stop(false);
    this.destroyed = true;
    if (this.io) this.io.disconnect();
    if (this.ro) this.ro.disconnect();
    if (this.mo) this.mo.disconnect();
    if (this.onResize) window.removeEventListener('resize', this.onResize);
    document.removeEventListener('visibilitychange', this.onVis);
  };

  Player.prototype.maybeAutoPlay = function () {
    if (this.reduced || this.userPaused || this.playing || !this.visible || document.hidden) return;
    // Don't burn the animation behind the paywall or before access is decided.
    if (this.slot.closest && this.slot.closest('.paywall-dimmed, .gate-pending')) return;
    var atEnd = this.idx >= this.sb.frames.length - 1;
    if (atEnd && !this.autoPaused) return;          // played through once: never loop by itself
    this.autoPaused = false;
    this.play();
  };

  Player.prototype.holdMs = function (k) {
    var fr = this.sb.frames[k];
    var base = fr.hold || Math.max(2600, Math.min(9000, 1500 + fr.caption.length * 38));
    return base / this.speed;
  };

  Player.prototype.play = function () {
    if (this.idx >= this.sb.frames.length - 1) this.go(0, false);
    this.playing = true; this.userPaused = false;
    this.updateControls();
    this.schedule();
  };

  Player.prototype.schedule = function () {
    var self = this;
    clearTimeout(this.timer);
    this.timer = setTimeout(function () {
      if (!self.playing || self.destroyed) return;
      var last = self.sb.frames.length - 1;
      if (self.idx >= last) { self.stop(false); return; }
      self.go(self.idx + 1, true);
      if (self.idx >= last) { self.stop(false); return; }
      self.schedule();
    }, this.holdMs(this.idx));
  };

  Player.prototype.stop = function (byUser) {
    clearTimeout(this.timer); this.timer = null;
    this.playing = false;
    if (byUser) { this.userPaused = true; this.autoPaused = false; }
    if (this.root) this.updateControls();
  };

  Player.prototype.togglePlay = function () {
    if (this.playing) this.stop(true);
    else { this.userPaused = false; this.play(); }
  };

  Player.prototype.userStep = function (d) {
    this.stop(true);
    this.go(this.idx + d, d > 0);
  };

  Player.prototype.setSpeed = function (s) {
    if (!(s > 0)) return;
    this.speed = s;
    Array.prototype.forEach.call(this.root.querySelectorAll('.sp-speed button'), function (b) {
      b.setAttribute('aria-pressed', +b.getAttribute('data-speed') === s ? 'true' : 'false');
    });
    if (this.playing) this.schedule();
  };

  Player.prototype.go = function (k, animate) {
    var n = this.sb.frames.length;
    k = Math.max(0, Math.min(n - 1, k));
    // Only a single forward step tweens; jumps, back-steps and redraws snap.
    var tween = animate !== false && !this.reduced && this.drawn && k === this.idx + 1;
    this.idx = k;
    this.draw(tween);
    var fr = this.sb.frames[k];
    this.elStep.textContent = 'Step ' + (k + 1) + ' of ' + n;
    this.elCapTitle.textContent = fr.title;
    this.elCap.textContent = fr.caption;
    this.scrub.value = String(k);
    this.scrub.setAttribute('aria-valuetext', 'Step ' + (k + 1) + ' of ' + n + (fr.title ? ': ' + fr.title : ''));
    this.root.style.setProperty('--sp-pct', (n > 1 ? (k / (n - 1)) * 100 : 100) + '%');
    this.updateControls();
  };

  Player.prototype.updateControls = function () {
    var last = this.sb.frames.length - 1, atEnd = this.idx >= last, b = this.btnPlay;
    var state = this.playing ? 'pause' : (atEnd ? 'replay' : 'play');
    if (b.getAttribute('data-state') !== state) {
      b.setAttribute('data-state', state);
      b.innerHTML = IC[state];
      b.setAttribute('aria-label', state === 'pause' ? 'Pause' : (state === 'replay' ? 'Replay from the start' : 'Play'));
    }
    this.btnPrev.disabled = this.idx <= 0;
    this.btnNext.disabled = atEnd;
    this.root.classList.toggle('is-playing', this.playing);
    // Announce captions to screen readers when stepping by hand; a caption
    // every few seconds during autoplay would be noise.
    this.elCap.setAttribute('aria-live', this.playing ? 'off' : 'polite');
  };

  // ---- drawing -------------------------------------------------------------
  Player.prototype.draw = function (tween) {
    var sb = this.sb, W = this.chart.clientWidth;
    if (!W) return;                                  // not laid out yet; ResizeObserver calls back
    this.lastW = W; this.drawn = true;
    var H = Math.round(Math.max(240, Math.min(380, W * 0.5)));
    var padL = 6, padR = 6, padT = 24, padB = 20;
    var n = sb.candles.length, plotW = W - padL - padR, plotH = H - padT - padB;
    var slot = plotW / n, bw = Math.max(2, Math.min(16, slot * 0.62));
    var speed = this.speed;

    // One price range over the WHOLE storyboard, so nothing rescales between frames.
    var lo = Infinity, hi = -Infinity;
    sb.candles.forEach(function (c) { if (c.l < lo) lo = c.l; if (c.h > hi) hi = c.h; });
    sb.frames.forEach(function (f) {
      f.add.forEach(function (a) {
        [a.price, a.top, a.bottom, a.a && a.a.price, a.b && a.b.price].forEach(function (p) {
          if (num(p)) { if (p < lo) lo = p; if (p > hi) hi = p; }
        });
      });
    });
    var span = (hi - lo) || 1; lo -= span * 0.05; hi += span * 0.05; span = hi - lo;
    function X(i) { return padL + slot * (i + 0.5); }
    function Xl(i) { return padL + slot * i; }
    function Xr(i) { return padL + slot * (i + 1); }
    function Y(p) { return padT + (hi - p) / span * plotH; }
    function r(v) { return Math.round(v * 10) / 10; }

    var k = this.idx, fr = sb.frames[k];
    var prevReveal = (tween && k > 0) ? sb.frames[k - 1].reveal : fr.reveal;
    var newCandles = Math.max(0, fr.reveal - prevReveal);
    var perCandle = newCandles > 8 ? 55 : 90;
    // New annotations wait for the new candles to land first.
    var lead = tween && newCandles ? newCandles * perCandle + 200 : 0;
    var act = activeAt(sb, k), focus = fr.focus;
    var labels = [];
    var out = [];

    function isNew(it) { return tween && it.bornAt === k; }
    function cls(it, base) {
      var c = base;
      if (focus && focus.indexOf(it.a.id) < 0) c += ' sp-dim';
      if (isNew(it)) c += ' sp-new';
      return c;
    }
    function delay(it, extra) {
      return isNew(it) ? ' style="animation-delay:' + Math.round((lead + (extra || 0)) / speed) + 'ms;animation-duration:' + Math.round(600 / speed) + 'ms"' : '';
    }
    function label(it, x, y, anchor, text, tone) {
      if (text) labels.push({ it: it, x: x, y: y, anchor: anchor, text: text, tone: tone });
    }

    out.push('<svg class="sp-svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" aria-hidden="true" focusable="false">');
    for (var g = 1; g <= 4; g++) {
      var gy = r(padT + plotH * g / 5);
      out.push('<line class="sp-grid" x1="' + padL + '" x2="' + (W - padR) + '" y1="' + gy + '" y2="' + gy + '"/>');
    }

    // Bands and zones sit under the candles.
    act.forEach(function (it) {
      var a = it.a;
      if (a.type === 'band') {
        var x1 = r(Xl(a.from)), x2 = r(Xr(a.to));
        out.push('<rect class="' + cls(it, 'sp-band sp-fade') + '"' + delay(it) + ' x="' + x1 + '" y="' + padT + '" width="' + r(x2 - x1) + '" height="' + r(plotH) + '"/>');
        label(it, x1 + 4, padT - 8, 'start', a.label, 'band');
      } else if (a.type === 'zone') {
        var zx1 = r(Xl(a.from)), zx2 = r(Xr(a.to)), zy1 = r(Y(a.top)), zy2 = r(Y(a.bottom));
        out.push('<rect class="' + cls(it, 'sp-zone sp-t-' + a.tone + ' sp-grow') + '"' + delay(it) + ' x="' + zx1 + '" y="' + zy1 + '" width="' + r(zx2 - zx1) + '" height="' + Math.max(2, r(zy2 - zy1)) + '" rx="2"/>');
        var left = a.labelSide === 'left';
        label(it, left ? zx1 + 3 : zx2 - 3, zy2 + 13, left ? 'start' : 'end', a.label, a.tone);
      }
    });

    // Candles.
    out.push('<g class="sp-candles">');
    for (var i = 0; i < fr.reveal; i++) {
      var c = sb.candles[i], up = c.c >= c.o;
      var cx = r(X(i)), yt = r(Y(Math.max(c.o, c.c))), yb = r(Y(Math.min(c.o, c.c)));
      var fresh = tween && i >= prevReveal;
      var st = fresh ? ' style="animation-delay:' + Math.round((i - prevReveal) * perCandle / speed) + 'ms;animation-duration:' + Math.round(420 / speed) + 'ms"' : '';
      out.push('<g class="sp-c ' + (up ? 'sp-up' : 'sp-dn') + (fresh ? ' sp-new sp-rise' : '') + '"' + st + '>' +
        '<line x1="' + cx + '" x2="' + cx + '" y1="' + r(Y(c.h)) + '" y2="' + r(Y(c.l)) + '"/>' +
        '<rect x="' + r(cx - bw / 2) + '" y="' + yt + '" width="' + r(bw) + '" height="' + Math.max(1, r(yb - yt)) + '" rx="1"/></g>');
    }
    out.push('</g>');

    // Lines and markers.
    var DFLT = { mss: 'MSS', entry: 'Entry', stop: 'Stop', target: 'Target' };
    act.forEach(function (it) {
      var a = it.a, y, x1, x2;
      switch (a.type) {
        case 'level': case 'mss': case 'entry': case 'stop': case 'target':
          y = r(Y(a.price));
          x1 = r(a.type === 'mss' ? X(a.from) : Xl(a.from));
          x2 = r(a.type === 'mss' ? X(a.to) : Xr(a.to));
          var tone = a.type === 'level' ? a.tone : a.type;
          out.push('<line class="' + cls(it, 'sp-line sp-l-' + tone + ' sp-grow') + '"' + delay(it) + ' x1="' + x1 + '" x2="' + x2 + '" y1="' + y + '" y2="' + y + '"/>');
          var txt = a.label || DFLT[a.type] || '';
          if (a.type === 'mss') label(it, r((x1 + x2) / 2), y - 6, 'middle', txt, 'mss');
          else if (a.labelSide === 'left') label(it, x1 + 3, y - 5, 'start', txt, tone);
          else label(it, x2 - 3, y - 5, 'end', txt, tone);
          break;
        case 'highlight':
          var hl = sb.candles.slice(a.from, a.to + 1);
          var hh = Math.max.apply(null, hl.map(function (q) { return q.h; }));
          var ll = Math.min.apply(null, hl.map(function (q) { return q.l; }));
          var hx1 = r(Xl(a.from) + 0.5), hx2 = r(Xr(a.to) - 0.5);
          out.push('<rect class="' + cls(it, 'sp-hl sp-fade') + '"' + delay(it) + ' x="' + hx1 + '" y="' + r(Y(hh) - 5) + '" width="' + r(hx2 - hx1) + '" height="' + r(Y(ll) - Y(hh) + 10) + '" rx="5"/>');
          break;
        case 'sweep':
          var sc = sb.candles[a.at], sp = a.side === 'high' ? sc.h : sc.l;
          var sy = r(Y(sp)), sx = r(X(a.at));
          // One style attribute only (a second one would be dropped by the parser).
          out.push('<g class="' + cls(it, 'sp-sweep sp-pop') + '" style="transform-origin:' + sx + 'px ' + sy + 'px' +
            (isNew(it) ? ';animation-delay:' + Math.round(lead / speed) + 'ms;animation-duration:' + Math.round(600 / speed) + 'ms' : '') + '">' +
            '<circle cx="' + sx + '" cy="' + sy + '" r="7"/><circle class="sp-dot" cx="' + sx + '" cy="' + sy + '" r="2.4"/></g>');
          label(it, sx, a.side === 'high' ? sy - 13 : sy + 21, 'middle', a.label, 'sweep');
          break;
        case 'arrow':
          var ax1 = X(a.a.at), ay1 = Y(a.a.price), ax2 = X(a.b.at), ay2 = Y(a.b.price);
          var ang = Math.atan2(ay2 - ay1, ax2 - ax1), hs = 7;
          out.push('<g class="' + cls(it, 'sp-arrow sp-fade') + '"' + delay(it) + '><path d="M' + r(ax1) + ' ' + r(ay1) + 'L' + r(ax2) + ' ' + r(ay2) + '"/>' +
            '<path class="sp-ahead" d="M' + r(ax2) + ' ' + r(ay2) + 'L' + r(ax2 - hs * Math.cos(ang - 0.45)) + ' ' + r(ay2 - hs * Math.sin(ang - 0.45)) +
            'L' + r(ax2 - hs * Math.cos(ang + 0.45)) + ' ' + r(ay2 - hs * Math.sin(ang + 0.45)) + 'Z"/></g>');
          label(it, r((ax1 + ax2) / 2 + 7), r((ay1 + ay2) / 2), 'start', a.label, 'neutral');
          break;
        case 'note':
          label(it, r(X(a.at)), r(Y(a.price)), 'middle', a.label, 'note');
          break;
      }
    });

    // Labels last, on top, clamped inside the chart so nothing is cut off.
    // Two labels at the same price (a target on an old high, say) would
    // print on top of each other, so a label that would overlap one already
    // placed is nudged up or down a line until it is clear.
    var placed = [];
    // Markers are obstacles too: a label never sits on a sweep circle.
    act.forEach(function (it) {
      if (it.a.type !== 'sweep') return;
      var c = sb.candles[it.a.at], py = Y(it.a.side === 'high' ? c.h : c.l), px = X(it.a.at);
      placed.push([px - 9, py - 9, px + 9, py + 9]);
    });
    function box(x, y, wdt, anchor) {
      var x0 = anchor === 'start' ? x : (anchor === 'end' ? x - wdt : x - wdt / 2);
      return [x0 - 2, y - 10, x0 + wdt + 2, y + 3];
    }
    function hits(b) {
      for (var q = 0; q < placed.length; q++) {
        var p = placed[q];
        if (b[0] < p[2] && b[2] > p[0] && b[1] < p[3] && b[3] > p[1]) return true;
      }
      return false;
    }
    labels.forEach(function (L) {
      var approx = L.text.length * 6.3, x = L.x;
      if (L.anchor === 'start') x = Math.max(padL, Math.min(x, W - padR - approx));
      else if (L.anchor === 'end') x = Math.min(W - padR, Math.max(x, padL + approx));
      else x = Math.min(Math.max(x, padL + approx / 2), W - padR - approx / 2);
      var y0 = Math.min(Math.max(L.y, 11), H - 5), y = y0;
      var tries = [0, 13, -13, 26, -26, 39];
      for (var t = 0; t < tries.length; t++) {
        var yy = Math.min(Math.max(y0 + tries[t], 11), H - 5);
        if (!hits(box(x, yy, approx, L.anchor))) { y = yy; break; }
      }
      placed.push(box(x, y, approx, L.anchor));
      out.push('<text class="' + cls(L.it, 'sp-lab sp-lab-' + L.tone + ' sp-fade') + '"' + delay(L.it, 150) + ' x="' + r(x) + '" y="' + r(y) + '" text-anchor="' + L.anchor + '">' + esc(L.text) + '</text>');
    });

    out.push('</svg>');
    this.chart.style.height = H + 'px';
    this.chart.innerHTML = out.join('');
  };

  // ---- mount ---------------------------------------------------------------
  function mountSetupPlayer(slot, model) {
    if (!slot) return null;
    if (slot.__sp) { try { slot.__sp.destroy(); } catch (e) {} slot.__sp = null; }
    slot.innerHTML = '';
    slot.hidden = true;
    var sb = null;
    try { sb = validate(model && model.storyboard); } catch (e) { sb = null; }
    if (!sb) return null;
    try {
      slot.__sp = new Player(slot, sb, model && model.name);
      return slot.__sp;
    } catch (e) {
      console.error('Stryker: setup player could not start', e);
      if (slot.__sp) { try { slot.__sp.destroy(); } catch (e2) {} }
      slot.__sp = null; slot.innerHTML = ''; slot.hidden = true;
      return null;
    }
  }

  window.mountSetupPlayer = mountSetupPlayer;
  window.SetupPlayer = { validate: validate, mount: mountSetupPlayer };
})();
