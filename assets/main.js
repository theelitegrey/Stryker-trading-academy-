// Stryker Trading Academy — shared page interactions (all pages)

document.addEventListener('DOMContentLoaded', () => {

  // Real enrolled-student count (index.html hero stat). Reads a single
  // count-only public doc (publicStats/enrollment) rather than querying the
  // students collection directly — a broad count() aggregation over
  // students would require a Firestore rule that also permits reading every
  // student's actual data in full, which isn't an acceptable tradeoff for a
  // homepage stat. See progress.js for where this doc gets incremented.
  const enrolledStatEl = document.getElementById('hero-enrolled-count');
  if (enrolledStatEl && typeof db !== 'undefined' && db) {
    db.collection('publicStats').doc('enrollment').get()
      .then((doc) => { if (doc.exists) enrolledStatEl.textContent = (doc.data().count || 0).toLocaleString(); })
      .catch((err) => { console.error('Stryker: failed to load enrolled count', err); });
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

});
