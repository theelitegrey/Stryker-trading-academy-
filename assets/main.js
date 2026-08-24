// Stryker Trading Academy — shared page interactions (all pages)

document.addEventListener('DOMContentLoaded', () => {

  // Beta announcement banner (index.html) — dismiss and remember, so
  // returning visitors aren't shown it again every visit.
  const betaBanner = document.getElementById('beta-banner');
  const betaBannerClose = document.getElementById('beta-banner-close');
  if (betaBanner) {
    try {
      if (localStorage.getItem('stryker_beta_banner_dismissed') === '1') betaBanner.style.display = 'none';
    } catch (e) { /* storage unavailable, fail open and just show the banner */ }
  }
  if (betaBannerClose) {
    betaBannerClose.addEventListener('click', () => {
      betaBanner.style.display = 'none';
      try { localStorage.setItem('stryker_beta_banner_dismissed', '1'); } catch (e) { /* fail silently */ }
    });
  }

  // Mobile nav toggle (marketing pages: index.html, courses.html)
  const navToggle = document.querySelector('.nav-toggle');
  const navLinks = document.querySelector('.nav-links');
  if (navToggle && navLinks) {
    navToggle.addEventListener('click', () => {
      const open = navLinks.style.display === 'flex';
      navLinks.style.display = open ? 'none' : 'flex';
      navLinks.style.cssText += open ? '' : 'position:absolute;top:64px;left:0;right:0;background:#0a0d13;flex-direction:column;padding:20px 32px;border-bottom:1px solid #232a3d;gap:18px;z-index:99;';
    });
  }

  // Scroll reveal
  const revealEls = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window && revealEls.length) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach(e => {
        if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
      });
    }, { threshold: 0.12 });
    revealEls.forEach(el => io.observe(el));
  } else {
    revealEls.forEach(el => el.classList.add('in'));
  }

  // Parallax layers (home page hero + band)
  const parallaxEls = document.querySelectorAll('[data-parallax]');
  if (parallaxEls.length && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    let ticking = false;
    const onScroll = () => {
      if (!ticking) {
        window.requestAnimationFrame(() => {
          const y = window.scrollY;
          parallaxEls.forEach(el => {
            const speed = parseFloat(el.dataset.parallax) || 0.15;
            el.style.transform = 'translate3d(0,' + (y * speed) + 'px,0)';
          });
          ticking = false;
        });
        ticking = true;
      }
    };
    window.addEventListener('scroll', onScroll, { passive: true });
  }

  // Student / Admin role toggle (login.html, signup.html) — purely a UI choice
  // that decides which dashboard page you land on after signing in. It is not
  // real access control (see note in auth.js).
  document.querySelectorAll('.role-toggle button').forEach(btn => {
    btn.addEventListener('click', () => {
      btn.parentElement.querySelectorAll('button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

});
