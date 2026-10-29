// TradeZoro — Help Center (help.html)
//
// One data file (assets/help/help-data.json), loaded once. Everything else is
// client-side: instant fuzzy search, filters, category views, accordions, deep
// links and history. No backend. "Was this helpful?" is stored on this device only
// (localStorage) because the site has no feedback collection to write to.
//
// URL state:  /help?q=…&cat=…&sub=…&plan=free|pro&level=beginner|advanced#item-id
(function () {
  'use strict';

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var root = $('#hc-results');
  if (!root) return;
  var VER = (document.querySelector('meta[name="stryker-build"]') || {}).content || '1';
  var REDUCED = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var MAX_RESULTS = 60;

  var els = {
    form: $('#hc-form'), q: $('#hc-q'), clear: $('#hc-clear'), popular: $('#hc-popular'),
    count: $('#hc-count'), catSel: $('#hc-cat-sel'), reset: $('#hc-reset'), skel: $('#hc-skel'),
    filters: $('#hc-filters'), lb: $('#hc-lightbox')
  };

  // ---------- icons (24x24 stroke paths) ----------
  var ICONS = {
    rocket: '<path d="M5 15c-1.5 1-2 4-2 6 2 0 5-.5 6-2"/><path d="M12 15 9 12c1-4 4-8 11-9 0 7-5 10-9 11z"/><circle cx="15" cy="9" r="1.2"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    card: '<rect x="2.5" y="5" width="19" height="14" rx="2.5"/><path d="M2.5 10h19M6.5 15h4"/>',
    book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5z"/><path d="M20 17v4H6.5A2.5 2.5 0 0 1 4 18.5"/>',
    chart: '<path d="M3 17l5-6 4 4 8-9"/><path d="M15 6h5v5"/>',
    gauge: '<path d="M4 18a8 8 0 1 1 16 0"/><path d="m12 18 4-6"/><circle cx="12" cy="18" r="1.2"/>',
    replay: '<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/><path d="M12 7v5l3 2"/>',
    journal: '<path d="M6 3h12a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H6z"/><path d="M6 3v18M10 8h6M10 12h6"/>',
    shield: '<path d="M12 3 4.5 6v6c0 4.5 3 7.5 7.5 9 4.5-1.5 7.5-4.5 7.5-9V6z"/><path d="m9 12 2 2 4-4"/>',
    bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>',
    plug: '<path d="M9 2v6M15 2v6M6 8h12v4a6 6 0 0 1-12 0z"/><path d="M12 18v4"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
    lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    wrench: '<path d="M14.7 6.3a4 4 0 0 0 5 5L21 12.6l-8.4 8.4a2.1 2.1 0 0 1-3-3L18 9.6z" transform="translate(-1 -1)"/><path d="m7 17 .01 0"/>',
    'life-buoy': '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3.5"/><path d="m5.6 5.6 3.9 3.9M14.5 14.5l3.9 3.9M18.4 5.6l-3.9 3.9M9.5 14.5l-3.9 3.9"/>',
    stats: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    wave: '<path d="M2 12c2-6 4-6 6 0s4 6 6 0 4-6 6 0"/>',
    layers: '<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5"/>'
  };
  function svg(name, size) {
    return '<svg width="' + (size || 22) + '" height="' + (size || 22) + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICONS[name] || ICONS.grid) + '</svg>';
  }

  // ---------- tiny helpers ----------
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function plural(n, w) { return n + ' ' + w + (n === 1 ? '' : 's'); }
  function stripTags(h) { return String(h).replace(/<[^>]*>/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim(); }

  // allow-list sanitizer for answer HTML (first-party data, still defence in depth)
  var OK_TAGS = { P: 1, UL: 1, OL: 1, LI: 1, STRONG: 1, EM: 1, A: 1, CODE: 1, BR: 1, KBD: 1, IMG: 1 };
  function safeHref(h) { return /^(\/(?!\/)|#|mailto:|https:\/\/|[a-z0-9][a-z0-9\-\/_.]*(\?[^ ]*)?(#[^ ]*)?$)/i.test(h) && !/^\s*javascript:/i.test(h); }
  function sanitize(html) {
    var doc = new DOMParser().parseFromString('<body>' + html + '</body>', 'text/html');
    (function walk(node) {
      Array.prototype.slice.call(node.childNodes).forEach(function (n) {
        if (n.nodeType === 8) { n.remove(); return; }
        if (n.nodeType !== 1) return;
        if (!OK_TAGS[n.tagName]) { n.replaceWith(document.createTextNode(n.textContent)); return; }
        Array.prototype.slice.call(n.attributes).forEach(function (a) {
          var keep = (n.tagName === 'A' && a.name === 'href' && safeHref(a.value)) ||
            (n.tagName === 'IMG' && ((a.name === 'src' && /^\/assets\/help\/shots\/[\w\-.]+$/.test(a.value)) || a.name === 'alt'));
          if (!keep) n.removeAttribute(a.name);
        });
        if (n.tagName === 'IMG' && !n.getAttribute('src')) { n.remove(); return; }
        walk(n);
      });
    })(doc.body);
    return doc.body.innerHTML;
  }

  // ---------- data ----------
  var DATA = null, ITEMS = [], BY_ID = {}, CATS = [], CAT_BY_ID = {};

  function loadData() {
    return fetch('/assets/help/help-data.json?v=' + encodeURIComponent(VER), { credentials: 'omit' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
  }

  // ---------- search index ----------
  var STOP = {};
  'a an the and or of to in on at is are was be do does did i my me we our you your it its this that these those how what why when where which can could should would will with for from by as if not no so but about into just get got has have there any'.split(' ').forEach(function (w) { STOP[w] = 1; });
  // Synonyms only widen the match (original word still counts); keep the map small and obvious.
  var SYN_ALSO = { cancle: ['cancel'], unsubscribe: ['cancel'], unsub: ['cancel'], pw: ['password'], passwd: ['password'], signin: ['sign', 'login'], logon: ['login'], logout: ['sign'], signout: ['sign'], gamma: ['gex'], erase: ['delete'], discount: ['coupon'], promo: ['coupon'], voucher: ['coupon'], backtest: ['replay'], backtesting: ['replay'], money: ['payment'], bill: ['payment'], fee: ['price'], cost: ['price'], subscription: ['plan'], broker: ['rithmic'], futures: ['rithmic'], bug: ['report'], error: ['problem'] };

  function stem(w) {
    if (w.length > 5 && /ing$/.test(w)) w = w.slice(0, -3);
    else if (w.length > 4 && /ed$/.test(w)) w = w.slice(0, -2);
    else if (w.length > 4 && /ies$/.test(w)) w = w.slice(0, -3) + 'y';
    else if (w.length > 3 && /s$/.test(w) && !/ss$/.test(w)) w = w.slice(0, -1);
    if (w.length > 4 && /e$/.test(w)) w = w.slice(0, -1);
    return w;
  }
  function words(text) {
    return String(text).toLowerCase().replace(/[’']/g, '').split(/[^a-z0-9]+/).filter(Boolean);
  }
  function stems(text, dropStop) {
    return words(text).filter(function (w) { return !(dropStop && STOP[w]); }).map(stem);
  }
  // optimal-string-alignment distance (counts a swap of two letters as 1), bounded
  function dist(a, b, max) {
    var la = a.length, lb = b.length;
    if (Math.abs(la - lb) > max) return max + 1;
    var prev2 = null, prev = [], cur = [], i, j;
    for (j = 0; j <= lb; j++) prev[j] = j;
    for (i = 1; i <= la; i++) {
      cur = [i];
      var rowMin = i;
      for (j = 1; j <= lb; j++) {
        var cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
        var v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
        if (prev2 && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
        cur[j] = v;
        if (v < rowMin) rowMin = v;
      }
      if (rowMin > max) return max + 1;
      prev2 = prev; prev = cur;
    }
    return prev[lb];
  }

  var VOCAB = {};            // stem -> true, over every indexed field

  function indexItem(it) {
    var f = {
      title: stems(it.q), tags: stems((it.tags || []).join(' ')),
      path: stems(it.path || ''), body: stems(stripTags(it.a) + ' ' + (it.steps || []).join(' '))
    };
    it._f = {};
    Object.keys(f).forEach(function (k) {
      var set = {};
      f[k].forEach(function (s) { set[s] = 1; VOCAB[s] = 1; });
      it._f[k] = set;
    });
    it._tagText = (it.tags || []).join(' ').toLowerCase();
    it._titleLow = it.q.toLowerCase();
    it._plain = stripTags(it.a);
  }

  var VOCAB_LIST = null;
  // Expand one query word to {stem: quality}: exact 1, prefix .85, typo .6
  function expand(tok) {
    var out = {}, s = stem(tok), m;
    out[s] = 1;
    var also = SYN_ALSO[tok];
    if (also) also.forEach(function (a) { out[stem(a)] = Math.max(out[stem(a)] || 0, .8); });
    if (!VOCAB_LIST) VOCAB_LIST = Object.keys(VOCAB);
    var limit = s.length >= 8 ? 2 : s.length >= 4 ? 1 : 0;
    for (var i = 0; i < VOCAB_LIST.length; i++) {
      var v = VOCAB_LIST[i];
      if (out[v] === 1) continue;
      if (s.length >= 3 && v.length > s.length && v.indexOf(s) === 0) { out[v] = Math.max(out[v] || 0, .85); continue; }
      if (limit && (m = dist(s, v, limit)) <= limit) out[v] = Math.max(out[v] || 0, m === 0 ? 1 : .6);
    }
    return out;
  }
  var W = { title: 10, tags: 7, path: 3, body: 1.6 };
  function bestIn(set, exp) {
    var best = 0;
    for (var k in exp) if (set[k] && exp[k] > best) best = exp[k];
    return best;
  }

  // returns [{it, score}] sorted; also the highlight stems
  function search(query, pool) {
    var toks = words(query).filter(function (w) { return !STOP[w]; });
    if (!toks.length) toks = words(query);
    if (!toks.length) return { hits: [], stems: {} };
    toks = toks.slice(0, 8);
    var exps = toks.map(expand);
    var hl = {};
    exps.forEach(function (e) { for (var k in e) hl[k] = 1; });
    var need = toks.length <= 2 ? toks.length : toks.length - 1;
    var phrase = words(query).join(' ');
    var hits = [];
    pool.forEach(function (it) {
      var score = 0, matched = 0;
      exps.forEach(function (e) {
        var best = 0;
        for (var fld in W) {
          var q = bestIn(it._f[fld], e);
          if (q) best = Math.max(best, W[fld] * q);
        }
        if (best) { matched++; score += best; }
      });
      if (matched < need) return;
      if (matched === toks.length) score += 4;
      if (phrase.length > 2 && it._titleLow.indexOf(phrase) >= 0) score += 12;
      else if (phrase.length > 2 && it._tagText.indexOf(phrase) >= 0) score += 6;
      hits.push({ it: it, score: score });
    });
    hits.sort(function (a, b) { return b.score - a.score || a.it._order - b.it._order; });
    return { hits: hits, stems: hl };
  }

  function highlight(text, hl) {
    var out = '', last = 0, re = /[A-Za-z0-9’']+/g, m;
    while ((m = re.exec(text))) {
      var w = m[0].toLowerCase().replace(/[’']/g, '');
      if (hl[stem(w)]) { out += esc(text.slice(last, m.index)) + '<mark>' + esc(m[0]) + '</mark>'; last = m.index + m[0].length; }
    }
    return out + esc(text.slice(last));
  }
  function snippet(it, hl) {
    var t = it._plain, re = /[A-Za-z0-9’']+/g, m, at = -1;
    while ((m = re.exec(t))) { if (hl[stem(m[0].toLowerCase().replace(/[’']/g, ''))]) { at = m.index; break; } }
    var start = at < 0 ? 0 : Math.max(0, at - 50);
    if (start > 0) { var sp = t.indexOf(' ', start); if (sp > 0 && sp < at) start = sp + 1; }
    var s = t.slice(start, start + 150);
    return (start > 0 ? '… ' : '') + highlight(s, hl) + (start + 150 < t.length ? ' …' : '');
  }

  // ---------- state & URL ----------
  var S = { q: '', cat: '', sub: '', plan: 'all', level: 'all', open: '' };

  function readURL() {
    var p = new URLSearchParams(location.search);
    var s = { q: (p.get('q') || '').slice(0, 120), cat: p.get('cat') || '', sub: p.get('sub') || '', plan: p.get('plan') || 'all', level: p.get('level') || 'all', open: '' };
    if (['all', 'free', 'pro'].indexOf(s.plan) < 0) s.plan = 'all';
    if (['all', 'beginner', 'advanced'].indexOf(s.level) < 0) s.level = 'all';
    if (s.cat && !CAT_BY_ID[s.cat]) s.cat = '';
    var h = decodeURIComponent((location.hash || '').replace(/^#(item-)?/, ''));
    if (h && BY_ID[h]) s.open = h;
    return s;
  }
  function buildURL(s, withHash) {
    var p = new URLSearchParams();
    if (s.q) p.set('q', s.q);
    if (s.cat) p.set('cat', s.cat);
    if (s.cat && s.sub) p.set('sub', s.sub);
    if (s.plan !== 'all') p.set('plan', s.plan);
    if (s.level !== 'all') p.set('level', s.level);
    var qs = p.toString();
    return location.pathname + (qs ? '?' + qs : '') + (withHash && s.open ? '#' + s.open : '');
  }
  function pushState(replace) {
    var url = buildURL(S, true);
    if (url === location.pathname + location.search + location.hash) return;
    history[replace ? 'replaceState' : 'pushState'](null, '', url);
  }

  // ---------- filtering ----------
  function passes(it) {
    if (S.plan === 'free' && it.plans === 'pro') return false;
    if (S.plan === 'pro' && it.plans !== 'pro') return false;
    if (S.level === 'beginner' && it.level === 'advanced') return false;
    if (S.level === 'advanced' && it.level !== 'advanced') return false;
    return true;
  }
  function filtersActive() { return S.plan !== 'all' || S.level !== 'all'; }

  // ---------- rendering ----------
  var openIds = {};   // item ids that are expanded (survive re-render within a view)

  function planBadge(it) {
    if (!it.plans) return '';
    var map = { free: ['Free', 'free'], pro: ['Pro', 'pro'], all: ['Everyone', 'all'] };
    var b = map[it.plans]; if (!b) return '';
    return '<span class="hc-badge hc-badge-' + b[1] + '">' + b[0] + '</span>';
  }
  function levelBadge(it) {
    return it.level ? '<span class="hc-badge hc-badge-lvl">' + (it.level === 'advanced' ? 'Advanced' : 'Beginner') + '</span>' : '';
  }

  function itemHTML(it, hl, showCrumb) {
    var id = 'item-' + it.id;
    var title = hl ? highlight(it.q, hl) : esc(it.q);
    var meta = planBadge(it) + levelBadge(it);
    return '<article class="hc-item" id="' + id + '" data-id="' + esc(it.id) + '">' +
      '<h3 class="hc-item-h"><button type="button" class="hc-item-btn" aria-expanded="false" aria-controls="p-' + esc(it.id) + '" id="b-' + esc(it.id) + '">' +
        '<span class="hc-item-main">' +
          (showCrumb ? '<span class="hc-crumb">' + esc(it._cat.title) + ' <i aria-hidden="true">›</i> ' + esc(it._sub.title) + '</span>' : '') +
          '<span class="hc-item-q">' + title + '</span>' +
          (hl ? '<span class="hc-snip">' + snippet(it, hl) + '</span>' : '') +
        '</span>' +
        (meta ? '<span class="hc-item-meta">' + meta + '</span>' : '') +
        '<span class="hc-chev" aria-hidden="true"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg></span>' +
      '</button></h3>' +
      '<div class="hc-panel" id="p-' + esc(it.id) + '" role="region" aria-labelledby="b-' + esc(it.id) + '"><div class="hc-panel-in"><div class="hc-panel-body"></div></div></div>' +
    '</article>';
  }

  function votes() { try { return JSON.parse(localStorage.getItem('tz_help_votes') || '{}'); } catch (e) { return {}; } }
  function saveVote(id, v) { try { var o = votes(); o[id] = v; localStorage.setItem('tz_help_votes', JSON.stringify(o)); } catch (e) { /* private mode: vote just isn't remembered */ } }

  function fillPanel(article) {
    var body = $('.hc-panel-body', article);
    if (body.getAttribute('data-ready')) return;
    var it = BY_ID[article.getAttribute('data-id')];
    var h = '<div class="hc-answer">' + sanitize(it.a || '') + '</div>';
    if (it.steps && it.steps.length) {
      h += '<h4 class="hc-sh">Steps</h4><ol class="hc-steps">' + it.steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ol>';
    }
    if (it.path) h += '<p class="hc-path"><span class="hc-path-l">Where to find it</span><span class="hc-path-chip">' + esc(it.path) + '</span></p>';
    if (it.links && it.links.length) {
      h += '<div class="hc-links">' + it.links.map(function (l) {
        return safeHref(l.href) ? '<a class="hc-link" href="' + esc(l.href) + '">' + esc(l.label) + ' <span aria-hidden="true">→</span></a>' : '';
      }).join('') + '</div>';
    }
    var rel = (it.related || []).map(function (r) { return BY_ID[r]; }).filter(Boolean);
    if (rel.length) {
      h += '<div class="hc-rel"><h4 class="hc-sh">Related questions</h4><ul>' + rel.map(function (r) {
        return '<li><a href="#' + esc(r.id) + '" data-rel="' + esc(r.id) + '">' + esc(r.q) + '</a></li>';
      }).join('') + '</ul></div>';
    }
    var v = votes()[it.id];
    h += '<div class="hc-foot"><div class="hc-vote" data-id="' + esc(it.id) + '"><span class="hc-vote-l" id="v-' + esc(it.id) + '">Was this helpful?</span>' +
      '<button type="button" class="hc-vbtn" data-v="y" aria-pressed="' + (v === 'y') + '" aria-describedby="v-' + esc(it.id) + '">Yes</button>' +
      '<button type="button" class="hc-vbtn" data-v="n" aria-pressed="' + (v === 'n') + '" aria-describedby="v-' + esc(it.id) + '">No</button>' +
      '<span class="hc-vote-msg" role="status" aria-live="polite">' + voteMsg(v) + '</span></div>' +
      '<button type="button" class="hc-copy" data-copy="' + esc(it.id) + '"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/></svg><span>Copy link</span></button></div>';
    body.innerHTML = h;
    body.setAttribute('data-ready', '1');
    $$('img', body).forEach(function (im) {
      im.loading = 'lazy'; im.decoding = 'async';
      im.classList.add('hc-shot');
      im.tabIndex = 0; im.setAttribute('role', 'button');
      im.setAttribute('aria-label', 'Zoom screenshot: ' + (im.alt || 'screenshot'));
    });
    $$('.hc-answer a[href]', body).forEach(function (a) { if (/^https?:/i.test(a.getAttribute('href')) && a.hostname !== location.hostname) { a.target = '_blank'; a.rel = 'noopener'; } });
    if (S.q && body._hl) markNodes(body, body._hl);
  }
  function voteMsg(v) {
    if (v === 'y') return 'Thanks. Saved on this device only.';
    if (v === 'n') return 'Thanks. Saved on this device only. <a href="support">Ask Support</a>';
    return '';
  }

  function markNodes(rootEl, hl) {
    var w = document.createTreeWalker($('.hc-answer', rootEl) || rootEl, NodeFilter.SHOW_TEXT, null), nodes = [], n;
    while ((n = w.nextNode())) nodes.push(n);
    nodes.forEach(function (t) {
      if (!/[A-Za-z0-9]/.test(t.nodeValue)) return;
      var h = highlight(t.nodeValue, hl);
      if (h.indexOf('<mark>') < 0) return;
      var sp = document.createElement('span'); sp.innerHTML = h;
      t.replaceWith.apply(t, Array.prototype.slice.call(sp.childNodes));
    });
  }

  // expand / collapse (animated by CSS grid rows)
  function setOpen(article, open, opts) {
    opts = opts || {};
    var btn = $('.hc-item-btn', article);
    if (open) fillPanel(article);
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    article.classList.toggle('is-open', !!open);
    var id = article.getAttribute('data-id');
    if (open) openIds[id] = 1; else delete openIds[id];
    if (opts.url !== false) {
      if (open) { S.open = id; } else if (S.open === id) { S.open = ''; }
      pushState(true);
    }
  }
  function toggle(article) { setOpen(article, !article.classList.contains('is-open')); }

  // ----- views -----
  function viewHome(counts) {
    var h = '<div class="hc-grid" role="list">';
    CATS.forEach(function (c) {
      var n = counts[c.id] || 0;
      if (!n) return;
      h += '<a class="hc-card" role="listitem" href="' + buildURL({ q: '', cat: c.id, sub: '', plan: S.plan, level: S.level }, false) + '" data-cat="' + esc(c.id) + '">' +
        '<span class="hc-card-ic">' + svg(c.icon, 24) + '</span>' +
        '<span class="hc-card-t">' + esc(c.title) + '</span>' +
        '<span class="hc-card-d">' + esc(c.desc || '') + '</span>' +
        '<span class="hc-card-n">' + plural(n, 'question') + '</span></a>';
    });
    h += '</div>';
    if (!CATS.some(function (c) { return counts[c.id]; })) h = noResultsHTML('');
    return h;
  }

  function viewCategory(cat) {
    var subs = cat.subs.map(function (s) {
      return { s: s, items: s.items.filter(passes) };
    }).filter(function (x) { return x.items.length; });
    var total = subs.reduce(function (a, x) { return a + x.items.length; }, 0);
    var subSel = S.sub && subs.some(function (x) { return x.s.id === S.sub; }) ? S.sub : '';
    var nav = '<nav class="hc-subnav" aria-label="' + esc(cat.title) + ' topics"><a href="#" class="hc-back" data-home="1">← All categories</a>' +
      '<ul class="hc-subnav-list">' +
      '<li><button type="button" class="hc-sub' + (!subSel ? ' on' : '') + '" data-sub="" aria-pressed="' + !subSel + '">All <b>' + total + '</b></button></li>' +
      subs.map(function (x) {
        return '<li><button type="button" class="hc-sub' + (subSel === x.s.id ? ' on' : '') + '" data-sub="' + esc(x.s.id) + '" aria-pressed="' + (subSel === x.s.id) + '">' + esc(x.s.title) + ' <b>' + x.items.length + '</b></button></li>';
      }).join('') + '</ul></nav>';
    var main = '<div class="hc-cat-main"><div class="hc-cat-head"><span class="hc-card-ic">' + svg(cat.icon, 26) + '</span><div><h2 class="hc-cat-t" id="hc-cat-h" tabindex="-1">' + esc(cat.title) + '</h2><p>' + esc(cat.desc || '') + '</p></div></div>';
    subs.forEach(function (x) {
      if (subSel && x.s.id !== subSel) return;
      main += '<section class="hc-subsec" aria-labelledby="sh-' + esc(x.s.id) + '"><h3 class="hc-subsec-h" id="sh-' + esc(x.s.id) + '">' + esc(x.s.title) + '</h3><div class="hc-list">' +
        x.items.map(function (it) { return itemHTML(it, null, false); }).join('') + '</div></section>';
    });
    if (!total) main += noResultsHTML('');
    main += '</div>';
    return '<div class="hc-catview">' + nav + main + '</div>';
  }

  function suggestedHTML() {
    var ids = suggestedIds();
    return '<ul class="hc-sugg">' + ids.map(function (id) { var it = BY_ID[id]; return '<li><a href="#' + esc(id) + '" data-open="' + esc(id) + '">' + esc(it.q) + '</a></li>'; }).join('') + '</ul>';
  }
  function noResultsHTML(q) {
    return '<div class="hc-empty"><div class="hc-empty-ic">' + svg('life-buoy', 30) + '</div>' +
      '<h2>' + (q ? 'No results for “' + esc(q) + '”' : 'Nothing matches these filters') + '</h2>' +
      '<p>' + (q ? 'Check the spelling, try fewer or simpler words, or clear the filters.' : 'Try clearing the filters.') + '</p>' +
      '<div class="hc-empty-btns">' + (filtersActive() || S.cat ? '<button type="button" class="btn btn-ghost btn-sm" id="hc-clear-all">Clear filters</button>' : '') +
      '<a class="btn btn-primary btn-sm" href="support">Ask Support</a></div>' +
      '<h3 class="hc-sugg-h">Popular questions</h3>' + suggestedHTML() + '</div>';
  }

  function viewSearch() {
    var pool = ITEMS.filter(function (it) { return passes(it) && (!S.cat || it._cat.id === S.cat); });
    var res = search(S.q, pool);
    lastHL = res.stems;
    var n = res.hits.length;
    var scope = S.cat ? '<span class="hc-scope">in ' + esc(CAT_BY_ID[S.cat].title) + ' <button type="button" id="hc-scope-x" aria-label="Search all categories">×</button></span>' : '';
    if (!n) return { html: noResultsHTML(S.q), n: 0 };
    var shown = res.hits.slice(0, MAX_RESULTS);
    var h = '<div class="hc-res-head">' + scope + '</div><div class="hc-list">' + shown.map(function (x) { return itemHTML(x.it, res.stems, true); }).join('') + '</div>';
    if (n > shown.length) h += '<p class="hc-more">Showing the top ' + shown.length + ' of ' + n + '. Add a word to narrow it down.</p>';
    return { html: h, n: n };
  }
  var lastHL = {};

  function countsByCat() {
    var c = {};
    ITEMS.forEach(function (it) { if (passes(it)) c[it._cat.id] = (c[it._cat.id] || 0) + 1; });
    return c;
  }

  function render(opts) {
    opts = opts || {};
    var counts = countsByCat();
    var total = ITEMS.filter(passes).length;
    var mode;
    document.body.classList.remove('hc-mode-home', 'hc-mode-cat', 'hc-mode-search');
    if (S.q) {
      var r = viewSearch();
      root.innerHTML = r.html;
      mode = 'search';
      els.count.textContent = r.n ? plural(r.n, 'result') + ' for “' + S.q + '”' : 'No results for “' + S.q + '”';
    } else if (S.cat) {
      root.innerHTML = viewCategory(CAT_BY_ID[S.cat]);
      mode = 'cat';
      var cn = counts[S.cat] || 0;
      els.count.textContent = plural(cn, 'question') + ' in ' + CAT_BY_ID[S.cat].title;
    } else {
      root.innerHTML = viewHome(counts);
      mode = 'home';
      var nCat = Object.keys(counts).length; els.count.textContent = plural(total, 'question') + ' in ' + nCat + (nCat === 1 ? ' category' : ' categories');
    }
    document.body.classList.add('hc-mode-' + mode);
    // keep search box and filters in sync with state
    if (els.q.value !== S.q) els.q.value = S.q;
    els.clear.hidden = !S.q;
    els.catSel.value = S.cat;
    $$('[data-filter]', els.filters).forEach(function (g) {
      var key = g.getAttribute('data-filter');
      $$('button', g).forEach(function (b) { b.setAttribute('aria-checked', b.getAttribute('data-v') === S[key] ? 'true' : 'false'); });
    });
    els.reset.hidden = !(filtersActive() || S.cat);
    // reopen anything that was open and still exists in this view
    $$('.hc-item', root).forEach(function (a) {
      var id = a.getAttribute('data-id');
      if (id === S.open || (openIds[id] && !opts.collapse)) {
        var body = $('.hc-panel-body', a); body._hl = S.q ? lastHL : null;
        setOpen(a, true, { url: false });
      }
    });
    if (els.skel) { els.skel.remove(); els.skel = null; }
    var st = $('#help-static'); if (st) st.remove();
  }

  // set + render + URL helpers
  function go(patch, mode) {
    // mode: 'push' (default), 'replace', or 'none'
    var prevQ = S.q;
    Object.keys(patch).forEach(function (k) { S[k] = patch[k]; });
    if (patch.cat !== undefined && patch.sub === undefined) S.sub = '';
    if (patch.q === undefined || patch.cat !== undefined || patch.plan !== undefined || patch.level !== undefined) { /* keep S.open only if set explicitly */ }
    if (!('open' in patch)) S.open = '';
    openIds = patch.open ? (function () { var o = {}; o[patch.open] = 1; return o; })() : {};
    render({ collapse: true });
    if (mode !== 'none') pushState(mode === 'replace' || (prevQ && S.q));
  }

  // open a specific item: right category, expanded, scrolled
  function openItem(id, opts) {
    opts = opts || {};
    var it = BY_ID[id]; if (!it) return;
    var inView = $('#item-' + CSS.escape(id), root);
    if (!inView) {
      // item not in the current view: show its category (drop filters that hide it)
      var patch = { q: '', cat: it._cat.id, sub: '', open: id };
      if (!passes(it)) { S.plan = 'all'; S.level = 'all'; }
      go(patch, opts.push === false ? 'none' : 'push');
      inView = $('#item-' + CSS.escape(id), root);
    } else {
      setOpen(inView, true);
    }
    if (inView) {
      var body = $('.hc-panel-body', inView); if (S.q) { body._hl = lastHL; }
      scrollToEl(inView);
    }
  }
  function scrollToEl(el) {
    var go = function () { el.scrollIntoView({ block: 'start', behavior: REDUCED ? 'auto' : 'smooth' }); };
    requestAnimationFrame(function () { requestAnimationFrame(go); });
  }

  // ---------- popular chips ----------
  var POPULAR_IDS = ['cancel-subscription', 'reset-password', 'refund', 'free-vs-pro', 'rithmic-connect', 'gex-what-is', 'candles-not-moving', 'delete-account', 'push-enable', 'coupon-problem'];
  function suggestedIds() {
    var ids = POPULAR_IDS.filter(function (id) { return BY_ID[id]; });
    if (ids.length < 6) ITEMS.some(function (it) { if (ids.indexOf(it.id) < 0) ids.push(it.id); return ids.length >= 6; });
    return ids.slice(0, 6);
  }
  function renderPopular() {
    var ids = POPULAR_IDS.filter(function (id) { return BY_ID[id]; }).slice(0, 8);
    if (ids.length < 4) ids = suggestedIds();
    els.popular.innerHTML = '<span class="hc-pop-l">Popular</span>' + ids.map(function (id) {
      return '<a class="hc-chip" href="#' + esc(id) + '" data-open="' + esc(id) + '">' + esc(BY_ID[id].q.replace(/\?$/, '')) + '</a>';
    }).join('');
  }

  // ---------- lightbox ----------
  var lbFrom = null;
  function lbOpen(img) {
    lbFrom = img;
    var big = $('img', els.lb);
    big.src = img.currentSrc || img.src; big.alt = img.alt || '';
    els.lb.hidden = false;
    document.documentElement.classList.add('hc-lb-on');
    $('.hc-lb-x', els.lb).focus();
  }
  function lbClose() {
    if (els.lb.hidden) return;
    els.lb.hidden = true;
    document.documentElement.classList.remove('hc-lb-on');
    $('img', els.lb).removeAttribute('src');
    if (lbFrom && document.contains(lbFrom)) lbFrom.focus();
  }

  // ---------- events ----------
  function copyLink(id, btn) {
    var url = location.origin + location.pathname + '#' + id;
    var done = function () {
      var s = $('span', btn); var old = s.textContent; s.textContent = 'Link copied'; btn.classList.add('ok');
      setTimeout(function () { s.textContent = old; btn.classList.remove('ok'); }, 1800);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done, function () { fallbackCopy(url); done(); });
    else { fallbackCopy(url); done(); }
  }
  function fallbackCopy(t) {
    var ta = document.createElement('textarea'); ta.value = t; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;opacity:0;top:0';
    document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); } catch (e) { /* nothing else to try */ } ta.remove();
  }

  function bind() {
    // search
    els.form.addEventListener('submit', function (e) { e.preventDefault(); var first = $('.hc-item-btn', root); if (first && S.q) first.focus(); });
    els.q.addEventListener('input', function () {
      var v = els.q.value.replace(/\s+/g, ' ').replace(/^\s/, '');
      var wasEmpty = !S.q;
      S.q = v.slice(0, 120); S.open = ''; openIds = {};
      render({ collapse: true });
      pushState(!wasEmpty || !S.q);
    });
    els.q.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') { var f = $('.hc-item-btn', root); if (f) { e.preventDefault(); f.focus(); } }
      else if (e.key === 'Escape' && S.q) { go({ q: '' }); els.q.focus(); }
    });
    els.clear.addEventListener('click', function () { go({ q: '' }); els.q.focus(); });
    document.addEventListener('keydown', function (e) {
      if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey && !/^(INPUT|TEXTAREA|SELECT)$/.test((document.activeElement || {}).tagName || '') && !(document.activeElement || {}).isContentEditable) {
        e.preventDefault(); els.q.focus(); els.q.select();
      } else if (e.key === 'Escape' && !els.lb.hidden) { lbClose(); }
    });

    // filters
    els.filters.addEventListener('click', function (e) {
      var b = e.target.closest('.hc-seg button'); if (b) { var key = b.parentNode.getAttribute('data-filter'); var p = {}; p[key] = b.getAttribute('data-v'); go(p, 'replace'); return; }
      if (e.target.closest('#hc-reset')) go({ plan: 'all', level: 'all', cat: '' }, 'push');
    });
    els.catSel.addEventListener('change', function () { go({ cat: els.catSel.value }, 'push'); });

    // results area (delegated)
    root.addEventListener('click', function (e) {
      var t = e.target;
      var btn = t.closest('.hc-item-btn'); if (btn) { var a = btn.closest('.hc-item'); var body = $('.hc-panel-body', a); body._hl = S.q ? lastHL : null; toggle(a); return; }
      var card = t.closest('.hc-card'); if (card) { e.preventDefault(); go({ cat: card.getAttribute('data-cat'), q: '' }); window.scrollTo(0, 0); var h = $('#hc-cat-h'); if (h) h.focus({ preventScroll: true }); return; }
      var sub = t.closest('.hc-sub'); if (sub) { go({ sub: sub.getAttribute('data-sub') }, 'replace'); var nb = $('.hc-sub.on'); if (nb) nb.focus({ preventScroll: true }); return; }
      if (t.closest('[data-home]')) { e.preventDefault(); go({ cat: '', q: '' }); window.scrollTo(0, 0); return; }
      var rel = t.closest('[data-rel]'); if (rel) { e.preventDefault(); openItem(rel.getAttribute('data-rel')); return; }
      var op = t.closest('[data-open]'); if (op) { e.preventDefault(); openItem(op.getAttribute('data-open')); return; }
      var vb = t.closest('.hc-vbtn'); if (vb) {
        var box = vb.closest('.hc-vote'), id = box.getAttribute('data-id'), v = vb.getAttribute('data-v');
        saveVote(id, v);
        $$('.hc-vbtn', box).forEach(function (x) { x.setAttribute('aria-pressed', x === vb ? 'true' : 'false'); });
        $('.hc-vote-msg', box).innerHTML = voteMsg(v); return;
      }
      var cp = t.closest('.hc-copy'); if (cp) { copyLink(cp.getAttribute('data-copy'), cp); return; }
      var im = t.closest('img.hc-shot'); if (im) { lbOpen(im); return; }
      if (t.closest('#hc-clear-all')) { go({ plan: 'all', level: 'all', cat: '', q: S.q }); return; }
      if (t.closest('#hc-scope-x')) { go({ cat: '' }); return; }
    });
    root.addEventListener('keydown', function (e) {
      var im = e.target.closest && e.target.closest('img.hc-shot');
      if (im && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); lbOpen(im); return; }
      var btn = e.target.closest && e.target.closest('.hc-item-btn'); if (!btn) return;
      var all = $$('.hc-item-btn', root), i = all.indexOf(btn);
      if (e.key === 'ArrowDown') { e.preventDefault(); (all[i + 1] || all[i]).focus(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); if (i === 0 && S.q) els.q.focus(); else (all[i - 1] || all[i]).focus(); }
      else if (e.key === 'Home') { e.preventDefault(); all[0].focus(); }
      else if (e.key === 'End') { e.preventDefault(); all[all.length - 1].focus(); }
    });
    els.popular.addEventListener('click', function (e) { var a = e.target.closest('[data-open]'); if (a) { e.preventDefault(); openItem(a.getAttribute('data-open')); } });
    els.lb.addEventListener('click', function (e) { if (e.target === els.lb || e.target.closest('.hc-lb-x')) lbClose(); });
    els.lb.addEventListener('keydown', function (e) { if (e.key === 'Tab') { e.preventDefault(); $('.hc-lb-x', els.lb).focus(); } });

    // history
    window.addEventListener('popstate', applyURL);
    window.addEventListener('hashchange', function () {
      var h = decodeURIComponent((location.hash || '').replace(/^#(item-)?/, ''));
      if (h && BY_ID[h] && S.open !== h) openItem(h, { push: false });
    });
  }

  function applyURL() {
    var s = readURL();
    S.q = s.q; S.cat = s.cat; S.sub = s.sub; S.plan = s.plan; S.level = s.level; S.open = s.open;
    openIds = s.open ? (function () { var o = {}; o[s.open] = 1; return o; })() : {};
    var target = s.open && BY_ID[s.open];
    if (target && !s.q && !s.cat) { S.cat = target._cat.id; if (!passes(target)) { S.plan = 'all'; S.level = 'all'; } }
    render({ collapse: true });
    if (S.open) { var a = $('#item-' + CSS.escape(S.open), root); if (a) scrollToEl(a); }
    else if (!lbFrom) window.scrollTo(0, 0);
  }

  // ---------- boot ----------
  function init(data) {
    DATA = data; CATS = data.categories || [];
    var order = 0;
    CATS.forEach(function (c) {
      CAT_BY_ID[c.id] = c;
      c.subs.forEach(function (s) {
        s.items.forEach(function (it) { it._cat = c; it._sub = s; it._order = order++; BY_ID[it.id] = it; ITEMS.push(it); indexItem(it); });
      });
    });
    els.catSel.innerHTML = '<option value="">All categories</option>' + CATS.map(function (c) { return '<option value="' + esc(c.id) + '">' + esc(c.title) + '</option>'; }).join('');
    renderPopular();
    if (window.matchMedia && matchMedia('(max-width:480px)').matches) els.q.placeholder = 'Search, e.g. cancel, Rithmic, GEX';
    bind();
    applyURLInitial();
    document.body.classList.add('hc-ready');
  }
  function applyURLInitial() {
    var s = readURL();
    S.q = s.q; S.cat = s.cat; S.sub = s.sub; S.plan = s.plan; S.level = s.level; S.open = s.open;
    var target = s.open && BY_ID[s.open];
    if (target) {
      openIds[s.open] = 1;
      if (!s.q) { S.cat = target._cat.id; if (!passes(target)) { S.plan = 'all'; S.level = 'all'; } }
    }
    render({ collapse: false });
    if (S.open) { var a = $('#item-' + CSS.escape(S.open), root); if (a) scrollToEl(a); }
  }

  loadData().then(init).catch(function (err) {
    if (els.skel) els.skel.remove();
    root.insertAdjacentHTML('afterbegin', '<div class="hc-empty"><h2>The Help Center could not load</h2><p>Check your connection and refresh the page. If it keeps happening, <a href="support">contact Support</a>.</p></div>');
    if (window.console) console.warn('help-data load failed', err);
  });
})();
