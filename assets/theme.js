// Stryker Trading Academy — day / night theme
//
// Night is the site's native look and stays byte-for-byte what it was; day is
// a real light palette built by overriding the design tokens in style.css
// (:root[data-theme="light"]), not a filter over the dark one.
//
// The choice lives in localStorage so it applies on the very first paint —
// a tiny snippet in every page's <head> reads the same key before the
// stylesheet paints, so there is no white/dark flash on navigation. When the
// student is signed in the choice is also mirrored to their student doc, so a
// new device picks up the theme they already chose.
//
// Anything that draws its own colours (canvas charts) should read them at
// draw time with strykerThemeColor('--ink-2') and re-render on the
// 'stryker:theme' event this file dispatches.

(function(){

  var KEY = 'stryker_theme';           // 'day' | 'night'
  var DEFAULT = 'night';

  function stored(){
    try { return localStorage.getItem(KEY); } catch (e) { return null; }
  }

  function current(){
    return document.documentElement.getAttribute('data-theme') === 'light' ? 'day' : 'night';
  }

  function apply(theme, animate){
    var day = theme === 'day';
    var root = document.documentElement;

    // A short transition class makes the switch read as a dissolve rather
    // than a hard repaint. It is removed again so it never slows normal
    // interaction (and is skipped for people who asked for less motion).
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (animate && !reduce) {
      root.classList.add('theme-anim');
      setTimeout(function(){ root.classList.remove('theme-anim'); }, 420);
    }

    if (day) root.setAttribute('data-theme', 'light');
    else root.removeAttribute('data-theme');

    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', day ? '#f5f7fa' : '#0b0b0d');

    document.querySelectorAll('[data-theme-toggle]').forEach(function (el){
      el.querySelectorAll('[data-theme-opt]').forEach(function (btn){
        var on = btn.dataset.themeOpt === theme;
        btn.classList.toggle('on', on);
        btn.setAttribute('aria-checked', on ? 'true' : 'false');
      });
      el.classList.toggle('is-day', day);
    });

    try { document.dispatchEvent(new CustomEvent('stryker:theme', { detail: { theme: theme } })); }
    catch (e) { /* older browsers just skip the redraw hook */ }
  }

  function save(theme){
    try { localStorage.setItem(KEY, theme); } catch (e) {}
    // Best effort only: the theme is already applied and stored locally.
    try {
      if (typeof auth !== 'undefined' && auth && auth.currentUser &&
          typeof db !== 'undefined' && db) {
        db.collection('students').doc(auth.currentUser.uid)
          .set({ theme: theme }, { merge: true }).catch(function(){});
      }
    } catch (e) {}
  }

  window.strykerTheme = current;

  window.setStrykerTheme = function (theme, opts){
    var t = theme === 'day' ? 'day' : 'night';
    apply(t, !(opts && opts.silent));
    save(t);
  };

  window.toggleStrykerTheme = function (){
    window.setStrykerTheme(current() === 'day' ? 'night' : 'day');
  };

  // For canvas/JS drawing: the live value of a design token in the current
  // theme, so charts repaint in the right palette instead of hardcoding one.
  window.strykerThemeColor = function (name, fallback){
    try {
      var v = getComputedStyle(document.documentElement).getPropertyValue(name);
      return (v && v.trim()) || fallback || '';
    } catch (e) { return fallback || ''; }
  };

  // Semantic colours for anything that draws itself (Chart.js datasets,
  // inline-styled dots, canvas). Same meanings in both themes; the day values
  // are darkened enough to stay legible on paper.
  window.strykerPalette = function (){
    var day = document.documentElement.getAttribute('data-theme') === 'light';
    return day ? {
      win:'#07996a', winSoft:'rgba(7,153,106,0.16)',
      loss:'#c9353a', lossSoft:'rgba(201,53,58,0.14)',
      warn:'#a5761a', warnSoft:'rgba(165,118,26,0.16)',
      gold:'#a5761a', teal:'#0b8a95', info:'#2563c9',
      ink0:'#0e1621', ink2:'#57626f', ink3:'#7b8593',
      line:'rgba(14,22,33,0.14)', track:'#e3e8ef', surface:'#ffffff'
    } : {
      win:'#03c988', winSoft:'rgba(3,201,136,0.15)',
      loss:'#e5484d', lossSoft:'rgba(229,72,77,0.15)',
      warn:'#f5c542', warnSoft:'rgba(245,197,66,0.15)',
      gold:'#f5c542', teal:'#00adb5', info:'#7fb4ff',
      ink0:'#eeeeee', ink2:'#8b93a0', ink3:'#5c6472',
      line:'rgba(62,69,80,0.6)', track:'#1e1e22', surface:'#131316'
    };
  };

  // The segmented Day/Night control. Used in the account menu, the profile
  // page and settings — same markup, styled by .theme-seg in style.css.
  window.strykerThemeToggleHtml = function (opts){
    opts = opts || {};
    var sun =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">' +
      '<circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2M12 19.5v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4' +
      'M2.5 12h2M19.5 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4"/></svg>';
    var moon =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round">' +
      '<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z"/></svg>';
    return '<div class="theme-seg' + (opts.large ? ' theme-seg-lg' : '') + '" data-theme-toggle role="radiogroup" aria-label="Site appearance">' +
      '<span class="theme-seg-glide" aria-hidden="true"></span>' +
      '<button type="button" class="theme-seg-opt" data-theme-opt="day" role="radio" aria-checked="false">' +
        '<span class="theme-seg-ic">' + sun + '</span>Day</button>' +
      '<button type="button" class="theme-seg-opt" data-theme-opt="night" role="radio" aria-checked="false">' +
        '<span class="theme-seg-ic">' + moon + '</span>Night</button>' +
    '</div>';
  };

  // Any toggle anywhere on the page works, including ones added later by
  // other scripts (the account menu builds its copy after auth resolves).
  // Capture phase on purpose: the account menu stops click propagation inside
  // its panel (so a click there doesn't close it), which would swallow a
  // bubbling listener here. Capturing runs first, and stopping propagation
  // then also keeps the panel open while you switch themes.
  document.addEventListener('click', function (e){
    var btn = e.target.closest && e.target.closest('[data-theme-opt]');
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    window.setStrykerTheme(btn.dataset.themeOpt);
  }, true);

  function init(){
    apply(stored() === 'day' ? 'day' : (stored() === 'night' ? 'night' : DEFAULT), false);

    // First sign-in on a new device: adopt the theme saved on the account
    // unless this device has already made its own choice.
    if (stored()) return;
    if (typeof auth === 'undefined' || !auth) return;
    auth.onAuthStateChanged(function (user){
      if (!user || stored() || typeof db === 'undefined' || !db) return;
      db.collection('students').doc(user.uid).get().then(function (doc){
        var t = doc.exists && doc.data().theme;
        if (t === 'day' || t === 'night') { apply(t, true); try { localStorage.setItem(KEY, t); } catch (e) {} }
      }).catch(function(){});
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

})();
