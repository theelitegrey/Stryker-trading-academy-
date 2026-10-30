// Creator Hub courses: shared player pieces (window.CHP).
//   parseVideo(url)        -> { provider, embed, thumb } for YouTube / Vimeo / Loom / Bunny / Cloudflare Stream links, or null
//   oembed(url)            -> Promise<{ title, thumb } | null>   (title + thumbnail where the provider allows it from a browser)
//   mountVideo(el, o)      -> controller; o = { url, user, start, onProgress(pct, sec, dur), onEnded() }
//   wmLabel(user)          -> "member@email.com · 30 Oct 2026 14:05" (watermark text)
//   watermark(box, label)  -> stop(); a low-opacity label that drifts around inside `box` (updates its time every 30 s)
//   pdf(el, getBuffer, label, o) -> viewer with a baked-in diagonal watermark on every page canvas
// Depends on: assets/creator.js (CH). Video progress uses each player's postMessage protocol (no third-party script is loaded):
// YouTube (enablejsapi) and Vimeo report playback; Loom / Bunny / Cloudflare Stream do not, so those lessons are marked complete by hand.
(function (g) {
  'use strict';
  var E = function (s) { return CH.esc(s); };

  // ---------------------------------------------------------------- video links
  function parseVideo(url) {
    url = String(url || '').trim(); var m, u;
    try { u = new URL(url); } catch (e) { return null; }
    if (u.protocol !== 'https:') return null;
    var h = u.hostname.replace(/^www\./, '').replace(/^m\./, ''), id;
    if (h === 'youtube.com' || h === 'youtube-nocookie.com' || h === 'youtu.be') {
      if (h === 'youtu.be') id = u.pathname.slice(1).split('/')[0];
      else if ((m = u.pathname.match(/^\/(?:embed|shorts|live|v)\/([\w-]{6,})/))) id = m[1];
      else id = u.searchParams.get('v');
      if (!id || !/^[\w-]{6,20}$/.test(id)) return null;
      return { provider: 'youtube', id: id, embed: 'https://www.youtube-nocookie.com/embed/' + id, thumb: 'https://i.ytimg.com/vi/' + id + '/hqdefault.jpg' };
    }
    if (h === 'vimeo.com' || h === 'player.vimeo.com') {
      m = u.pathname.match(/^\/(?:video\/)?(\d{5,12})(?:\/([0-9a-f]{6,20}))?/);
      if (!m) return null;
      var hash = m[2] || u.searchParams.get('h') || '';
      return { provider: 'vimeo', id: m[1], embed: 'https://player.vimeo.com/video/' + m[1] + (hash ? '?h=' + encodeURIComponent(hash) : ''), thumb: '' };
    }
    if (h === 'loom.com') {
      m = u.pathname.match(/^\/(?:share|embed)\/([0-9a-f]{20,40})/);
      return m ? { provider: 'loom', id: m[1], embed: 'https://www.loom.com/embed/' + m[1], thumb: '' } : null;
    }
    if (h === 'iframe.mediadelivery.net') {
      m = u.pathname.match(/^\/(?:embed|play)\/(\d+)\/([\w-]{20,50})/);
      return m ? { provider: 'bunny', id: m[2], embed: 'https://iframe.mediadelivery.net/embed/' + m[1] + '/' + m[2], thumb: '' } : null;
    }
    if (h === 'iframe.videodelivery.net' || /^[a-z0-9-]{3,60}\.cloudflarestream\.com$/.test(h)) {
      m = u.pathname.match(/^\/([0-9a-f]{32})(?:\/|$)/);
      if (!m) return null;
      var host = h === 'iframe.videodelivery.net' ? 'iframe.videodelivery.net' : h;
      return { provider: 'cloudflare', id: m[1], embed: 'https://' + host + '/' + m[1] + (h === 'iframe.videodelivery.net' ? '' : '/iframe'),
        thumb: h === 'iframe.videodelivery.net' ? '' : 'https://' + h + '/' + m[1] + '/thumbnails/thumbnail.jpg' };
    }
    return null;
  }

  function oembed(url) {
    var p = parseVideo(url); if (!p) return Promise.resolve(null);
    var ep = p.provider === 'youtube' ? 'https://www.youtube.com/oembed?format=json&url=' :
             p.provider === 'vimeo' ? 'https://vimeo.com/api/oembed.json?url=' :
             p.provider === 'loom' ? 'https://www.loom.com/v1/oembed?url=' : '';
    if (!ep) return Promise.resolve({ title: '', thumb: p.thumb });
    var ctl = typeof AbortController === 'function' ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctl) ctl.abort(); }, 6000);
    return fetch(ep + encodeURIComponent(url), ctl ? { signal: ctl.signal } : {}).then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        clearTimeout(timer);
        if (!d) return { title: '', thumb: p.thumb };
        var th = typeof d.thumbnail_url === 'string' && /^https:\/\//.test(d.thumbnail_url) ? d.thumbnail_url : p.thumb;
        return { title: String(d.title || '').slice(0, 100), thumb: th, mins: d.duration ? Math.max(1, Math.round(d.duration / 60)) : 0 };
      }).catch(function () { clearTimeout(timer); return { title: '', thumb: p.thumb }; });
  }

  // ---------------------------------------------------------------- watermark
  function wmLabel(u) {
    var d = new Date(), pad = function (n) { return (n < 10 ? '0' : '') + n; };
    var who = (u && (u.email || u.displayName)) || 'member';
    return who + ' · ' + d.getDate() + ' ' + ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()] + ' ' + d.getFullYear() + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }
  // Drifts to a new spot every few seconds; the text is re-stamped with the current time every 30 s.
  function watermark(box, user) {
    var el = document.createElement('div');
    el.className = 'cx-wm'; el.setAttribute('aria-hidden', 'true');
    el.textContent = wmLabel(user);
    box.appendChild(el);
    var reduce = g.matchMedia && g.matchMedia('(prefers-reduced-motion: reduce)').matches;
    function move() {
      el.style.left = (4 + Math.random() * 56).toFixed(1) + '%';
      el.style.top = (6 + Math.random() * 80).toFixed(1) + '%';
    }
    move();
    var t1 = setInterval(move, reduce ? 12000 : 5000), t2 = setInterval(function () { el.textContent = wmLabel(user); }, 30000);
    return function () { clearInterval(t1); clearInterval(t2); if (el.parentNode) el.parentNode.removeChild(el); };
  }

  // ---------------------------------------------------------------- video
  // Pure parser used by the tests: one message from a YouTube / Vimeo iframe -> { t, d, ended } or null.
  function readMessage(provider, raw) {
    var m = raw; if (typeof raw === 'string') { try { m = JSON.parse(raw); } catch (e) { return null; } }
    if (!m || typeof m !== 'object') return null;
    if (provider === 'youtube') {
      if (m.event === 'infoDelivery' && m.info) {
        var i = m.info, out = {};
        if (typeof i.currentTime === 'number') out.t = i.currentTime;
        if (typeof i.duration === 'number' && i.duration > 0) out.d = i.duration;
        if (i.playerState === 0) out.ended = true;
        return Object.keys(out).length ? out : null;
      }
      return null;
    }
    if (provider === 'vimeo') {
      if (m.event === 'timeupdate' && m.data) return { t: m.data.seconds, d: m.data.duration };
      if (m.event === 'ended' || m.event === 'finish') return { ended: true };
    }
    return null;
  }
  var ORIGINS = { youtube: 'https://www.youtube-nocookie.com', vimeo: 'https://player.vimeo.com' };

  function mountVideo(el, o) {
    var v = parseVideo(o.url), done = false, stopWm = null, lastSave = 0;
    el.innerHTML = '';
    if (!v) { el.innerHTML = '<div class="cx-empty">This video link could not be read.</div>'; return { destroy: function () {} }; }
    var wrap = document.createElement('div'); wrap.className = 'cx-vwrap';
    var src = v.embed, start = Math.max(0, Math.floor(o.start || 0));
    if (v.provider === 'youtube') src += '?enablejsapi=1&rel=0&playsinline=1&modestbranding=1&origin=' + encodeURIComponent(location.origin) + (start ? '&start=' + start : '');
    else if (v.provider === 'vimeo') src += (src.indexOf('?') < 0 ? '?' : '&') + 'dnt=1' + (start ? '#t=' + start + 's' : '');
    var f = document.createElement('iframe');
    f.title = o.title || 'Lesson video'; f.src = src; f.loading = 'lazy'; f.referrerPolicy = 'strict-origin-when-cross-origin';
    // No native fullscreen: it would hide the watermark. Our own button fullscreens the wrapper instead.
    f.setAttribute('allow', 'autoplay; encrypted-media; picture-in-picture; clipboard-write');
    wrap.appendChild(f);
    var fs = document.createElement('button'); fs.type = 'button'; fs.className = 'cx-vfs'; fs.setAttribute('aria-label', 'Full screen');
    fs.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3"/></svg>';
    fs.onclick = function () {
      if (document.fullscreenElement) document.exitFullscreen(); else if (wrap.requestFullscreen) wrap.requestFullscreen().catch(function () {});
    };
    wrap.appendChild(fs);
    el.appendChild(wrap);
    if (o.user) stopWm = watermark(wrap, o.user);

    function post(msg) { try { f.contentWindow.postMessage(typeof msg === 'string' ? msg : JSON.stringify(msg), ORIGINS[v.provider]); } catch (e) {} }
    function hello() {
      if (v.provider === 'youtube') post({ event: 'listening', id: 1, channel: 'widget' });
      else if (v.provider === 'vimeo') { ['timeupdate', 'ended'].forEach(function (n) { post({ method: 'addEventListener', value: n }); }); }
    }
    f.addEventListener('load', function () { hello(); setTimeout(hello, 1500); });
    var dur = 0, cur = 0;
    function onMsg(ev) {
      if (!ORIGINS[v.provider] || ev.origin !== ORIGINS[v.provider] || ev.source !== f.contentWindow) return;
      var r = readMessage(v.provider, ev.data); if (!r) return;
      if (typeof r.d === 'number') dur = r.d;
      if (typeof r.t === 'number') cur = r.t;
      if (r.ended && !done) { done = true; if (o.onProgress) o.onProgress(100, cur, dur); if (o.onEnded) o.onEnded(); return; }
      if (dur > 0 && o.onProgress) {
        var pct = Math.min(100, Math.round(cur / dur * 100)), now = Date.now();
        if (now - lastSave > 15000 || pct >= 95) { lastSave = now; o.onProgress(pct, cur, dur); }
        if (pct >= 95 && !done) { done = true; if (o.onEnded) o.onEnded(); }
      }
    }
    g.addEventListener('message', onMsg);
    function onHide() { if (document.visibilityState === 'hidden' && dur > 0 && o.onProgress && cur > 0) o.onProgress(Math.round(cur / dur * 100), cur, dur); }
    document.addEventListener('visibilitychange', onHide);
    return { provider: v.provider, tracks: v.provider === 'youtube' || v.provider === 'vimeo',
      destroy: function () { g.removeEventListener('message', onMsg); document.removeEventListener('visibilitychange', onHide); if (stopWm) stopWm(); el.innerHTML = ''; } };
  }

  // ---------------------------------------------------------------- PDF viewer
  var pdfReady = null;
  function loadPdfJs() {
    if (g.pdfjsLib) return Promise.resolve(g.pdfjsLib);
    if (!pdfReady) pdfReady = new Promise(function (res, rej) {
      var s = document.createElement('script'); s.src = '/assets/vendor/pdf-3.11.174.min.js';
      s.onload = function () { var L = g.pdfjsLib || g['pdfjs-dist/build/pdf']; if (!L) return rej(new Error('pdf')); L.GlobalWorkerOptions.workerSrc = '/assets/vendor/pdf-3.11.174.worker.min.js'; g.pdfjsLib = L; res(L); };
      s.onerror = function () { rej(new Error('pdf')); }; document.head.appendChild(s);
    });
    return pdfReady;
  }
  // Diagonal repeating label baked into the page bitmap (a screenshot of the page keeps it), plus the drifting label on top.
  function bake(ctx, w, h, text) {
    ctx.save(); ctx.globalAlpha = 0.11; ctx.fillStyle = '#7a7a82'; ctx.font = '600 ' + Math.max(12, Math.round(w / 38)) + 'px sans-serif';
    ctx.rotate(-Math.PI / 6);
    var step = Math.max(80, Math.round(w / 6)), tw = ctx.measureText(text).width + 60;
    for (var y = -h; y < h * 1.6; y += step) for (var x = -w; x < w * 1.6; x += tw) ctx.fillText(text, x + ((y / step) % 2 ? tw / 2 : 0), y);
    ctx.restore();
  }
  function pdf(el, getBuffer, user, o) {
    o = o || {};
    el.innerHTML = '<div class="cx-pdf"><div class="cx-pdfbar"><span class="cx-pdfn">Loading…</span><span class="cx-pdfz"></span></div><div class="cx-pdfpages stkc-scroll"></div></div>';
    var box = el.querySelector('.cx-pdf'), pages = el.querySelector('.cx-pdfpages'), nEl = el.querySelector('.cx-pdfn'), stopWm = watermark(box, user), dead = false;
    var label = wmLabel(user);
    Promise.all([loadPdfJs(), getBuffer()]).then(function (r) {
      return r[0].getDocument({ data: new Uint8Array(r[1]) }).promise;
    }).then(function (doc) {
      if (dead) return;
      nEl.textContent = doc.numPages + (doc.numPages === 1 ? ' page' : ' pages');
      var io = 'IntersectionObserver' in g ? new IntersectionObserver(function (es) {
        es.forEach(function (e) { if (e.isIntersecting && !e.target._done) { e.target._done = true; draw(e.target); io.unobserve(e.target); } });
      }, { root: pages, rootMargin: '600px 0px' }) : null;
      function draw(c) {
        doc.getPage(+c.dataset.p).then(function (pg) {
          var cw = Math.min(pages.clientWidth - 24, 900) || 320, vp0 = pg.getViewport({ scale: 1 }), sc = cw / vp0.width, dpr = Math.min(2, g.devicePixelRatio || 1);
          var vp = pg.getViewport({ scale: sc * dpr });
          c.width = vp.width; c.height = vp.height; c.style.width = cw + 'px'; c.style.height = Math.round(vp0.height * sc) + 'px';
          var ctx = c.getContext('2d');
          return pg.render({ canvasContext: ctx, viewport: vp }).promise.then(function () { bake(ctx, c.width, c.height, label); c.classList.add('ready'); });
        }).catch(function () {});
      }
      for (var i = 1; i <= doc.numPages; i++) {
        var c = document.createElement('canvas'); c.dataset.p = i; c.className = 'cx-pdfpage'; c.setAttribute('role', 'img'); c.setAttribute('aria-label', 'Page ' + i + ' of ' + doc.numPages);
        c.style.width = '100%'; c.style.height = '60vh'; c.addEventListener('contextmenu', function (e) { e.preventDefault(); });
        pages.appendChild(c); if (io) io.observe(c); else draw(c);
      }
      if (o.onLast) pages.addEventListener('scroll', function () { if (pages.scrollTop + pages.clientHeight >= pages.scrollHeight - 40) o.onLast(); });
    }).catch(function (e) {
      nEl.textContent = (e && e.message === 'pdf') ? 'The PDF viewer could not load.' : 'Could not open this PDF.';
      nEl.className = 'cx-bad';
    });
    return { destroy: function () { dead = true; stopWm(); el.innerHTML = ''; } };
  }

  g.CHP = { parseVideo: parseVideo, oembed: oembed, mountVideo: mountVideo, watermark: watermark, wmLabel: wmLabel, pdf: pdf, readMessage: readMessage };
})(window);
