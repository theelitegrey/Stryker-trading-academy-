// Videos load and play only while in view; reduced-motion keeps the poster.
(function(){
  var vs=[].slice.call(document.querySelectorAll('video[data-dc]'));
  if(!vs.length) return;
  if(window.matchMedia('(prefers-reduced-motion: reduce)').matches||!('IntersectionObserver' in window)) return;
  function load(v){var s=v.querySelector('source[data-src]');if(s){s.src=s.getAttribute('data-src');s.removeAttribute('data-src');v.preload='auto';v.load();}}
  var io=new IntersectionObserver(function(es){es.forEach(function(e){
    var v=e.target;
    if(e.isIntersecting){load(v);var p=v.play();if(p&&p.catch)p.catch(function(){});}else{v.pause();}
  });},{threshold:.35});
  vs.forEach(function(v){io.observe(v);});
})();
