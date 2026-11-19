// Marketing header (#site-nav) behaviours. Loaded right after the header on every marketing page.
// 1) "Download" dropdown: hover opens on mouse devices >= 900 px (180 ms close delay), click/tap toggles, Esc and outside click close.
// 2) Transparent at the top (Owner 19 Nov): the first block under the sticky header is pulled up behind it (.hdr-pad:
//    negative top margin + the same amount of extra top padding, so nothing moves), letting the hero background run up
//    behind the menu. Past 24 px of scroll the header gets .is-scrolled (translucent bar + hairline).
//    Depends on: style.css "Marketing header" rules (.hn / .nav, .hdr-ov, .hdr-pad, .is-scrolled).
(function(){
  var d=document.querySelector('.dl-menu'); if(!d) return;
  document.addEventListener('click',function(e){ if(d.open&&!d.contains(e.target)) d.open=false; });
  document.addEventListener('keydown',function(e){ if(e.key==='Escape'&&d.open){ d.open=false; var s=d.querySelector('summary'); if(s&&d.contains(document.activeElement)) s.focus(); } });
  if(!(window.matchMedia&&window.matchMedia('(hover:hover) and (pointer:fine)').matches)) return;
  var t=null, wide=function(){ return window.innerWidth>=900; };
  d.addEventListener('mouseenter',function(){ if(!wide()) return; clearTimeout(t); t=setTimeout(function(){ d.open=true; },80); });
  d.addEventListener('mouseleave',function(){ if(!wide()) return; clearTimeout(t); t=setTimeout(function(){ d.open=false; },180); });
})();
(function(){
  var nav=document.getElementById('site-nav'); if(!nav) return;
  var target=null, raf=0, rt=0;
  function plain(s){ return s.backgroundImage==='none'&&(s.backgroundColor==='transparent'||/rgba\(0, 0, 0, 0\)/.test(s.backgroundColor)); }
  // First visible block after the header; step into unpainted, unpadded wrappers (main, .dash-main) to reach the real hero.
  function find(){
    var el=nav.nextElementSibling, depth=0;
    while(el){
      var s=getComputedStyle(el);
      if(/^(SCRIPT|STYLE|LINK|TEMPLATE|NOSCRIPT)$/.test(el.tagName)||s.display==='none'||s.position==='fixed'||s.position==='absolute'||!el.offsetHeight){ el=el.nextElementSibling; continue; }
      if(depth<6&&plain(s)&&!parseFloat(s.paddingTop)&&!parseFloat(s.borderTopWidth)&&el.firstElementChild){ el=el.firstElementChild; depth++; continue; }
      return el;
    }
    return null;
  }
  function layout(){
    if(target){ target.classList.remove('hdr-pad'); target.style.removeProperty('--hdr-p0'); target.style.removeProperty('--hdr-h'); }
    nav.classList.remove('hdr-ov'); target=null;
    if(getComputedStyle(nav).display==='none'||!nav.offsetHeight) return;
    var t=find(); if(!t) return;
    var s=getComputedStyle(t);
    t.style.setProperty('--hdr-p0',(parseFloat(s.paddingTop)||0)+'px');
    t.style.setProperty('--hdr-h',nav.offsetHeight+'px');
    t.classList.add('hdr-pad'); nav.classList.add('hdr-ov'); target=t;
  }
  function paint(){ raf=0; nav.classList.toggle('is-scrolled',(window.scrollY||document.documentElement.scrollTop)>24); }
  function relayout(){ clearTimeout(rt); rt=setTimeout(layout,60); }
  layout(); paint();
  window.addEventListener('scroll',function(){ if(!raf) raf=requestAnimationFrame(paint); },{passive:true});
  window.addEventListener('resize',relayout);
  window.addEventListener('load',relayout);
  // Signed-in visitors on app-shell pages lose this header (html.nav-authed): re-measure when that flips.
  if(window.MutationObserver) new MutationObserver(relayout).observe(document.documentElement,{attributes:true,attributeFilter:['class']});
})();
