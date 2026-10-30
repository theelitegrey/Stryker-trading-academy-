// TradeZoro image cropper (no library, no CDN). Used by Creator settings for the community logo and cover.
//   ImgCrop.open(file, { kind: 'avatar' | 'cover' }) -> Promise<Blob | null>   (null = cancelled)
// Frame: avatar 1:1 (circle preview) -> 512x512; cover 3:1 -> 1800x600 (guides show where the logo and title sit on the page).
// Drag to move, wheel / pinch / slider to zoom, rotate 90 degrees, Apply / Cancel. Touch + mouse via Pointer Events.
// Output is WebP (JPEG where the browser cannot encode WebP). The image always covers the whole frame, so no empty edges.
(function () {
  var KINDS = {
    avatar: { w: 512, h: 512, title: 'Crop logo', hint: 'Drag to move. Pinch or use the slider to zoom.', q: 0.9 },
    cover: { w: 1800, h: 600, title: 'Crop cover', hint: 'Drag to move. Pinch or use the slider to zoom. The guide shows where the logo and title sit.', q: 0.85 }
  };
  var MAXSRC = 3200;   // working copy limit, keeps memory low on phones
  var ZMAX = 4;

  function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  var ICO = {
    rot: '<svg class="ic-c" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 4v5h-5"/></svg>',
    x: '<svg class="ic-c" viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12"/></svg>',
    minus: '<svg class="ic-c" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14"/></svg>',
    plus: '<svg class="ic-c" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
    grid: '<svg class="ic-c" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="3"/><path d="M9 3v18M15 3v18M3 9h18M3 15h18"/></svg>'
  };

  function load(file) {
    return new Promise(function (res, rej) {
      var url = URL.createObjectURL(file), im = new Image();
      im.onload = function () { URL.revokeObjectURL(url); res(im); };
      im.onerror = function () { URL.revokeObjectURL(url); rej(new Error('bad image')); };
      im.src = url;
    });
  }
  // working source: the image turned by `rot` quarter turns, drawn into a canvas (max MAXSRC on the long side)
  function makeSrc(im, rot) {
    var w = im.naturalWidth, h = im.naturalHeight, k = Math.min(1, MAXSRC / Math.max(w, h));
    var dw = Math.round(w * k), dh = Math.round(h * k), odd = rot % 2 === 1;
    var c = document.createElement('canvas'); c.width = odd ? dh : dw; c.height = odd ? dw : dh;
    var x = c.getContext('2d'); x.translate(c.width / 2, c.height / 2); x.rotate(rot * Math.PI / 2);
    x.imageSmoothingQuality = 'high'; x.drawImage(im, -dw / 2, -dh / 2, dw, dh);
    return c;
  }

  function open(file, opts) {
    var K = KINDS[(opts && opts.kind) === 'avatar' ? 'avatar' : 'cover'], isAv = K === KINDS.avatar;
    return load(file).then(function (im) {
      return new Promise(function (done) {
        var rot = 0, src = makeSrc(im, rot), z = 1, px = src.width / 2, py = src.height / 2, guides = !isAv;
        var prevFocus = document.activeElement;

        var back = el('div', 'icp-back'), dlg = el('div', 'icp-dlg ' + (isAv ? 'icp-av' : 'icp-cv'));
        dlg.setAttribute('role', 'dialog'); dlg.setAttribute('aria-modal', 'true'); dlg.setAttribute('aria-label', K.title);
        dlg.innerHTML =
          '<div class="icp-grab" aria-hidden="true"></div>' +
          '<div class="icp-hd"><h2>' + K.title + '</h2><button type="button" class="icp-x" aria-label="Cancel">' + ICO.x + '</button></div>' +
          '<div class="icp-stagewrap"><div class="icp-stage" tabindex="0" aria-label="Crop area. Arrow keys move, plus and minus zoom."><canvas></canvas>' +
          (isAv ? '<div class="icp-circle"></div>' : '<div class="icp-guide"><span class="icp-g-logo"></span><span class="icp-g-title"></span><i>Logo and title sit here</i></div>') +
          '<div class="icp-thirds"></div></div></div>' +
          '<p class="icp-hint">' + K.hint + '</p>' +
          '<div class="icp-ctl"><button type="button" class="icp-ib" data-a="out" aria-label="Zoom out">' + ICO.minus + '</button>' +
          '<input type="range" class="icp-rng" min="1" max="' + ZMAX + '" step="0.01" value="1" aria-label="Zoom">' +
          '<button type="button" class="icp-ib" data-a="in" aria-label="Zoom in">' + ICO.plus + '</button>' +
          '<button type="button" class="icp-ib" data-a="rot" aria-label="Rotate 90 degrees">' + ICO.rot + '</button>' +
          (isAv ? '' : '<button type="button" class="icp-ib icp-gt" data-a="guide" aria-label="Show or hide the guides" aria-pressed="true">' + ICO.grid + '</button>') + '</div>' +
          '<div class="icp-pv"><canvas class="icp-pvc"></canvas><span>Preview · ' + K.w + '×' + K.h + '</span></div>' +
          '<div class="icp-ft"><button type="button" class="icp-btn icp-cancel">Cancel</button><button type="button" class="icp-btn icp-ok">Apply</button></div>';
        back.appendChild(dlg); document.body.appendChild(back);
        document.documentElement.classList.add('icp-lock');
        requestAnimationFrame(function () { back.classList.add('on'); });

        var stage = dlg.querySelector('.icp-stage'), cv = stage.querySelector('canvas'), rng = dlg.querySelector('.icp-rng');
        var pvc = dlg.querySelector('.icp-pvc'), g = cv.getContext('2d');
        var W = 0, H = 0, dpr = Math.min(2, window.devicePixelRatio || 1);
        if (!isAv) { dlg.querySelector('.icp-gt').classList.add('on'); stage.classList.add('guides'); }

        function minScale() { return Math.max(W / src.width, H / src.height); }
        function scale() { return minScale() * z; }
        function clamp() {
          var s = scale(), hw = W / 2 / s, hh = H / 2 / s;
          px = Math.min(src.width - hw, Math.max(hw, px)); py = Math.min(src.height - hh, Math.max(hh, py));
        }
        function size() {
          W = stage.clientWidth; H = stage.clientHeight;   // layout size, not the transformed rect (the dialog animates scale)
          cv.width = W * dpr; cv.height = H * dpr; cv.style.width = W + 'px'; cv.style.height = H + 'px';
        }
        function paint(ctx, cw, ch, s) {
          ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, cw, ch); ctx.imageSmoothingQuality = 'high';
          ctx.translate(cw / 2, ch / 2); ctx.scale(s, s); ctx.translate(-px, -py); ctx.drawImage(src, 0, 0);
        }
        function draw() {
          clamp(); if (!W) return;
          paint(g, W * dpr, H * dpr, scale() * dpr);
          var pw = isAv ? 72 : 240; pvc.width = pw * dpr; pvc.height = Math.round(pw * K.h / K.w * dpr); pvc.style.width = pw + 'px'; pvc.style.height = Math.round(pw * K.h / K.w) + 'px';
          paint(pvc.getContext('2d'), pvc.width, pvc.height, scale() * pvc.width / W);
          rng.value = z;
        }
        function setZ(nz) { z = Math.min(ZMAX, Math.max(1, nz)); draw(); }
        size(); draw();
        var ro = window.ResizeObserver ? new ResizeObserver(function () { var oz = z; size(); z = oz; draw(); }) : null; if (ro) ro.observe(stage);

        // pointers: one = drag, two = pinch
        var pts = {}, last = null;
        function two() { var k = Object.keys(pts); return k.length === 2 ? [pts[k[0]], pts[k[1]]] : null; }
        stage.addEventListener('pointerdown', function (e) {
          stage.setPointerCapture(e.pointerId); pts[e.pointerId] = { x: e.clientX, y: e.clientY };
          var t = two(); last = t ? { d: Math.hypot(t[0].x - t[1].x, t[0].y - t[1].y), z: z } : null; stage.classList.add('drag'); stage.focus({ preventScroll: true });
        });
        stage.addEventListener('pointermove', function (e) {
          var p = pts[e.pointerId]; if (!p) return;
          var t = two();
          if (t) {
            pts[e.pointerId] = { x: e.clientX, y: e.clientY }; t = two();
            var d = Math.hypot(t[0].x - t[1].x, t[0].y - t[1].y); if (last && last.d) setZ(last.z * d / last.d); return;
          }
          var s = scale(); px -= (e.clientX - p.x) / s; py -= (e.clientY - p.y) / s; p.x = e.clientX; p.y = e.clientY; draw();
        });
        function up(e) { delete pts[e.pointerId]; last = null; var t = Object.keys(pts); if (!t.length) stage.classList.remove('drag'); }
        stage.addEventListener('pointerup', up); stage.addEventListener('pointercancel', up);
        stage.addEventListener('wheel', function (e) { e.preventDefault(); setZ(z * Math.exp(-e.deltaY * 0.0015)); }, { passive: false });
        rng.addEventListener('input', function () { setZ(parseFloat(rng.value)); });
        stage.addEventListener('keydown', function (e) {
          var st = 24 / scale(), used = true;
          if (e.key === 'ArrowLeft') px -= st; else if (e.key === 'ArrowRight') px += st; else if (e.key === 'ArrowUp') py -= st; else if (e.key === 'ArrowDown') py += st;
          else if (e.key === '+' || e.key === '=') z = Math.min(ZMAX, z * 1.1); else if (e.key === '-') z = Math.max(1, z / 1.1); else used = false;
          if (used) { e.preventDefault(); draw(); }
        });
        function rotate() { rot = (rot + 1) % 4; src = makeSrc(im, rot); z = 1; px = src.width / 2; py = src.height / 2; draw(); }
        dlg.querySelector('.icp-ctl').addEventListener('click', function (e) {
          var b = e.target.closest('button'); if (!b) return; var a = b.dataset.a;
          if (a === 'in') setZ(z * 1.25); else if (a === 'out') setZ(z / 1.25); else if (a === 'rot') rotate();
          else if (a === 'guide') { guides = !guides; stage.classList.toggle('guides', guides); b.classList.toggle('on', guides); b.setAttribute('aria-pressed', guides); }
        });

        function close(v) {
          document.removeEventListener('keydown', onKey, true); if (ro) ro.disconnect();
          back.classList.remove('on'); document.documentElement.classList.remove('icp-lock');
          setTimeout(function () { back.remove(); }, 220);
          if (prevFocus && prevFocus.focus) try { prevFocus.focus(); } catch (x) {}
          done(v);
        }
        function apply() {
          var ok = dlg.querySelector('.icp-ok'); ok.disabled = true; ok.textContent = 'Working…';
          var out = document.createElement('canvas'); out.width = K.w; out.height = K.h;
          var ctx = out.getContext('2d'); paint(ctx, K.w, K.h, scale() * K.w / W);
          // `src` is capped at MAXSRC; if the frame needs more pixels than that, the browser simply upsamples (never happens for 512 / 1800 wide)
          function fin(b) { close(b); }
          out.toBlob(function (b) {
            if (b && b.type === 'image/webp') return fin(b);
            out.toBlob(function (j) { fin(j); }, 'image/jpeg', K.q);
          }, 'image/webp', K.q);
        }
        function onKey(e) {
          if (e.key === 'Escape') { e.stopPropagation(); close(null); }
          else if (e.key === 'Tab') {   // keep focus inside the dialog
            var f = [].slice.call(dlg.querySelectorAll('button:not([disabled]),input,[tabindex="0"]')); if (!f.length) return;
            var i = f.indexOf(document.activeElement);
            if (e.shiftKey && (i <= 0)) { e.preventDefault(); f[f.length - 1].focus(); } else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
          }
        }
        document.addEventListener('keydown', onKey, true);
        dlg.querySelector('.icp-ok').addEventListener('click', apply);
        dlg.querySelector('.icp-cancel').addEventListener('click', function () { close(null); });
        dlg.querySelector('.icp-x').addEventListener('click', function () { close(null); });
        back.addEventListener('pointerdown', function (e) { if (e.target === back) close(null); });
        dlg.querySelector('.icp-ok').focus();
        // test hook (read-only state for automated checks)
        dlg._state = function () { return { z: z, px: px, py: py, rot: rot, W: W, H: H, sw: src.width, sh: src.height }; };
      });
    });
  }
  window.ImgCrop = { open: open, KINDS: KINDS };
})();
