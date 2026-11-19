// /download page (Owner 19 Nov). Depends on: assets/download-page.css; markup in download.html.
// OS highlight (Windows / Android button), install tabs, scroll reveal, phone parallax, and the small sample animations
// in the "Go beyond the chart" cards (all labelled Sample; nothing here is market data).
(function(){
  var html=document.documentElement, ua=navigator.userAgent||'';
  var reduce=window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches;
  var os=/Android/i.test(ua)?'and':(/Windows/i.test(ua)?'win':'');
  if(os){ var rec=document.getElementById('dp-'+os); if(rec) rec.classList.add('is-rec'); }

  // install tabs: default to the visitor's OS; arrow keys move between tabs
  var tabs=[].slice.call(document.querySelectorAll('.dp-seg [role="tab"]'));
  function sel(t,focus){ tabs.forEach(function(b){ var on=b===t; b.setAttribute('aria-selected',on?'true':'false'); b.tabIndex=on?0:-1; document.getElementById(b.getAttribute('aria-controls')).hidden=!on; }); if(focus) t.focus(); }
  tabs.forEach(function(b,i){
    b.addEventListener('click',function(){ sel(b); });
    b.addEventListener('keydown',function(e){ var d=e.key==='ArrowRight'?1:e.key==='ArrowLeft'?-1:0; if(d){ e.preventDefault(); sel(tabs[(i+d+tabs.length)%tabs.length],true); } });
  });
  if(os==='and'&&tabs[1]) sel(tabs[1]);

  // reveal on scroll
  var rv=[].slice.call(document.querySelectorAll('.dp-rv'));
  if('IntersectionObserver' in window&&!reduce){
    html.classList.add('dp-js');
    var io=new IntersectionObserver(function(es){ es.forEach(function(e){ if(e.isIntersecting){ e.target.classList.add('in'); io.unobserve(e.target); } }); },{rootMargin:'0px 0px -8% 0px'});
    rv.forEach(function(el){ io.observe(el); });
  }
  if(reduce) return;

  // phone parallax: drifts up a little as the stage scrolls
  var ph=document.querySelector('[data-dp-px]'), raf=0;
  if(ph) window.addEventListener('scroll',function(){ if(raf) return; raf=requestAnimationFrame(function(){ raf=0; var y=Math.min(window.scrollY,600); ph.style.setProperty('--dp-py',(-y*0.06).toFixed(1)+'px'); }); },{passive:true});

  function every(ms,fn){ setInterval(function(){ if(!document.hidden) fn(); },ms); }

  // indicators: toggle "added" one row at a time
  var adds=[].slice.call(document.querySelectorAll('[data-dp-ind] .dp-add')), ai=0;
  if(adds.length) every(1600,function(){ adds[ai%adds.length].classList.toggle('on'); ai++; });

  // alerts: a new sample alert slides in at the top, the oldest drops off
  var al=document.querySelector('[data-dp-alerts]'), samples=['GC crosses 2,650','ES touches prior day high','SOLUSDT above 240','NQ crosses 21,000'], si=0;
  if(al) every(3200,function(){
    var r=al.firstElementChild.cloneNode(true);
    r.querySelector('b').textContent=samples[si++%samples.length];
    var c=r.querySelector('.dp-chip'); c.className='dp-chip'; c.textContent='Active';
    r.classList.add('dp-new'); al.insertBefore(r,al.firstElementChild);
    if(al.children.length>3) al.removeChild(al.lastElementChild);
    setTimeout(function(){ r.classList.remove('dp-new'); },1400);
  });

  // paper ticket: the sample price ticks
  var px=document.querySelector('[data-dp-px-val]'), p=98412.5;
  if(px) every(1100,function(){
    var d=(Math.round((Math.random()-.48)*8)/2)||.5; p+=d;
    px.textContent=p.toLocaleString('en-US',{minimumFractionDigits:1,maximumFractionDigits:1});
    px.className='dp-px '+(d>0?'up':'dn');
  });

  // sync: add a symbol on the PC, it appears on the phone
  var pc=document.querySelector('[data-dp-pc]'), phl=document.querySelector('[data-dp-ph]'), ok=document.querySelector('[data-dp-synced]'), syms=[['GC','Futures'],['ETHUSDT','Crypto'],['ES','Futures']], yi=0;
  function li(s){ var l=document.createElement('li'); l.innerHTML='<b></b><span></span>'; l.firstChild.textContent=s[0]; l.lastChild.textContent=s[1]; l.className='dp-new'; return l; }
  if(pc&&phl&&ok) every(4200,function(){
    var s=syms[yi++%syms.length];
    if(pc.children.length>=3){ pc.removeChild(pc.lastElementChild); phl.removeChild(phl.lastElementChild); }
    pc.insertBefore(li(s),pc.firstChild); ok.classList.remove('on');
    setTimeout(function(){ phl.insertBefore(li(s),phl.firstChild); ok.classList.add('on'); },900);
  });
})();
