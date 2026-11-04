// Demo C v2. Hero chart drawn on canvas from nq-15m.json (real NQ bars). Tabs, footprint hover, layout picker, reveals, count-up.
(function(){
'use strict';
document.documentElement.classList.add('js');
var RM=window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches;
var DPR=Math.min(window.devicePixelRatio||1,2);
var MONO="500 11px 'JetBrains Mono',ui-monospace,monospace";
var UP='#03c988',DN='#ff5c6c';
var bars=null;

function fit(cv){var r=cv.getBoundingClientRect();var w=Math.max(1,Math.round(r.width)),h=Math.max(1,Math.round(r.height));
  if(cv._w!==w||cv._h!==h){cv.width=w*DPR;cv.height=h*DPR;cv._w=w;cv._h=h;}
  var x=cv.getContext('2d');x.setTransform(DPR,0,0,DPR,0,0);return{x:x,w:w,h:h};}
function fmt(n){return n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g,',');}

/* draw bars [a..a+n) ; the bar at index idx is the forming one with progress p */
function draw(cv,start,idx,p,opt){
  var f=fit(cv),x=f.x,W=f.w,H=f.h;opt=opt||{};
  var padR=opt.small?0:52,padT=opt.small?4:34,volH=opt.small?0:Math.round(H*.14),padB=opt.small?2:20;
  var n=opt.n,step=(W-padR-8)/n,cw=Math.max(1,step*.64);
  x.clearRect(0,0,W,H);
  var cur=bars[idx],path=pathOf(cur),pt=pointAt(path,p);
  var first=Math.max(0,idx-n+2),hi=-1e9,lo=1e9,vmax=0,i,b;
  for(i=first;i<=idx;i++){b=bars[i];var bh=b[2],bl=b[3];if(i===idx){bh=pt.h;bl=pt.l;}hi=Math.max(hi,bh);lo=Math.min(lo,bl);vmax=Math.max(vmax,b[5]);}
  var span=(hi-lo)||1;hi+=span*.06;lo-=span*.06;
  var s=cv._s;if(!s||opt.snap){s=cv._s={hi:hi,lo:lo};}else{s.hi+=(hi-s.hi)*.12;s.lo+=(lo-s.lo)*.12;}
  var plotB=H-padB-volH,Y=function(v){return padT+(s.hi-v)/(s.hi-s.lo)*(plotB-padT);};
  if(!opt.small){
    x.font=MONO;x.textBaseline='middle';x.lineWidth=1;
    var stepV=niceStep((s.hi-s.lo)/6),t;
    for(t=Math.ceil(s.lo/stepV)*stepV;t<s.hi;t+=stepV){var yy=Math.round(Y(t))+.5;x.strokeStyle='rgba(255,255,255,.05)';x.beginPath();x.moveTo(0,yy);x.lineTo(W-padR,yy);x.stroke();x.fillStyle='#6b7380';x.textAlign='left';x.fillText(fmt(t).replace(/\.00$/,''),W-padR+8,yy);}
  }
  var right=W-padR-4;
  var smaPts=[];
  for(i=first;i<=idx;i++){
    b=bars[i];var cx=right-(idx+p-i)*step+step*.5+ (idx+p-idx)*0; cx=right-(idx-i)*step-step*.5-(1-p)*0;
    var o=b[1],h=b[2],l=b[3],c=b[4],v=b[5];
    if(i===idx){h=pt.h;l=pt.l;c=pt.c;v=v*Math.min(1,p*1.1);}
    var upc=c>=o,col=upc?UP:DN;
    x.strokeStyle=col;x.fillStyle=col;x.lineWidth=1;
    var xx=Math.round(cx)+.5;x.beginPath();x.moveTo(xx,Y(h));x.lineTo(xx,Y(l));x.stroke();
    var yo=Y(o),yc=Y(c);x.fillRect(cx-cw/2,Math.min(yo,yc),cw,Math.max(1,Math.abs(yo-yc)));
    if(volH){x.globalAlpha=.35;var vh=v/vmax*volH;x.fillRect(cx-cw/2,H-padB-vh,cw,vh);x.globalAlpha=1;}
  }
  if(!opt.small&&idx>=20){ // SMA 20
    x.strokeStyle='#f5c518';x.lineWidth=1.25;x.beginPath();
    for(i=Math.max(first,19);i<=idx;i++){var sum=0,k;for(k=0;k<20;k++){var cc=(i-k===idx)?pt.c:bars[i-k][4];sum+=cc;}
      var px=right-(idx-i)*step-step*.5,py=Y(sum/20);if(i===Math.max(first,19))x.moveTo(px,py);else x.lineTo(px,py);}
    x.stroke();
  }
  if(!opt.small){
    var col2=pt.c>=cur[1]?UP:DN,ly=Math.round(Y(pt.c))+.5;
    x.setLineDash([3,3]);x.strokeStyle=col2;x.beginPath();x.moveTo(0,ly);x.lineTo(W-padR,ly);x.stroke();x.setLineDash([]);
    x.fillStyle=col2;x.fillRect(W-padR,ly-9,padR,18);x.fillStyle='#04110c';x.textAlign='left';x.font="600 11px 'JetBrains Mono',monospace";x.fillText(fmt(pt.c).replace(/\.00$/,''),W-padR+6,ly+.5);
    x.font=MONO;x.textAlign='left';x.fillStyle='#8b93a0';
    x.fillText('O '+fmt(cur[1])+'  H '+fmt(pt.h)+'  L '+fmt(pt.l)+'  C '+fmt(pt.c),12,16);
    x.fillStyle='#f5c518';x.fillText('SMA 20',12,H-padB-volH-8>60?34:34);
  } else {
    x.fillStyle='#6b7380';x.font="500 9px 'JetBrains Mono',monospace";x.textBaseline='top';x.fillText(opt.label||'',6,5);
  }
}
function pathOf(b){var o=b[1],h=b[2],l=b[3],c=b[4];return c>=o?[o,l,h,c]:[o,h,l,c];}
function pointAt(path,p){
  var seg=p*3,i=Math.min(2,Math.floor(seg)),t=seg-i,e=t*t*(3-2*t);
  var v=path[i]+(path[i+1]-path[i])*e,hi=path[0],lo=path[0],k;
  for(k=0;k<=i;k++){hi=Math.max(hi,path[k]);lo=Math.min(lo,path[k]);}
  hi=Math.max(hi,v);lo=Math.min(lo,v);return{c:v,h:hi,l:lo};
}
function niceStep(r){var m=Math.pow(10,Math.floor(Math.log10(r))),f=r/m;return (f<1.5?1:f<3.5?2:f<7.5?5:10)*m;}

/* ---------- hero ---------- */
function hero(){
  var cv=document.getElementById('hero-cv');if(!cv)return;
  var n=window.innerWidth<760?38:78,idx=Math.min(bars.length-2,n+20),p=0,last=0,run=false,raf=0,DUR=1500,fade=0;
  var END=bars.length-1;
  function frame(t){
    if(!run)return;
    if(!last)last=t;var dt=Math.min(64,t-last);last=t;
    p+=dt/DUR;
    if(p>=1){p-=1;idx++;if(idx>=END){idx=n+10;fade=1;}}
    draw(cv,0,idx,p,{n:n,snap:false});
    if(fade>0){fade=Math.max(0,fade-dt/500);cv.style.opacity=1-.6*fade;}else cv.style.opacity=1;
    raf=requestAnimationFrame(frame);
  }
  function start(){if(run||RM)return;run=true;last=0;raf=requestAnimationFrame(frame);}
  function stop(){run=false;cancelAnimationFrame(raf);}
  draw(cv,0,idx,.6,{n:n,snap:true});
  if(RM)return;
  if('IntersectionObserver' in window)new IntersectionObserver(function(es){es[0].isIntersecting&&!document.hidden?start():stop();},{threshold:.05}).observe(cv);else start();
  document.addEventListener('visibilitychange',function(){document.hidden?stop():start();});
  window.addEventListener('resize',function(){n=window.innerWidth<760?38:78;cv._s=null;if(RM)draw(cv,0,idx,.6,{n:n,snap:true});});
  window.__dcHero={set:function(i,pp){stop();idx=i;draw(cv,0,idx,pp,{n:n,snap:true});}};
}

/* ---------- layouts ---------- */
function layouts(){
  var grid=document.getElementById('lay-grid');if(!grid)return;
  var cols={1:1,2:2,4:2,16:4},rows={1:1,2:1,4:2,16:4},cvs=[],i;
  for(i=0;i<16;i++){var c=document.createElement('canvas');c.setAttribute('aria-hidden','true');grid.appendChild(c);cvs.push(c);}
  var syms=[['NQ1!',0],['ES1!',40],['NQ1!',90],['NQ1!',150]];
  function render(k){
    grid.style.gridTemplateColumns='repeat('+cols[k]+',1fr)';grid.style.gridTemplateRows='repeat('+rows[k]+',1fr)';
    cvs.forEach(function(c,j){c.classList.toggle('off',j>=k);});
    cvs.forEach(function(c,j){if(j>=k)return;var n=k===1?60:k===2?44:k===4?34:20;var o=(j*37)%140;
      draw(c,0,Math.min(bars.length-1,n+20+(o%100)),1,{n:n,small:true,snap:true,label:(j%2?'NQ1! 15m':'NQ1! 15m')+(k>4?'':'')});});
  }
  var btns=document.querySelectorAll('[data-lay]');
  btns.forEach(function(b){b.addEventListener('click',function(){btns.forEach(function(o){o.setAttribute('aria-pressed',o===b?'true':'false');});render(+b.getAttribute('data-lay'));var l=document.getElementById('lay-note');if(l)l.textContent=b.getAttribute('data-note');});});
  var cur=2;render(4);
  window.addEventListener('resize',function(){var a=document.querySelector('[data-lay][aria-pressed=true]');render(+a.getAttribute('data-lay'));});
  grid._render=render;
}

/* ---------- footprint ---------- */
var FP=[[5,29],[119,149],[176,134],[216,169],[236,105],[65,21],[72,40],[17,18],[199,140],[223,108],[206,244],[392,221],[286,242],[192,131],[256,64],[33,15],[222,149],[299,47],[116,70],[153,143],[195,184],[123,41]];
function footprint(){
  var tb=document.querySelector('.fpt tbody');if(!tb)return;
  var mx=0,tot=0,td=0,bt=0,at=0,poc=0;
  FP.forEach(function(r,i){mx=Math.max(mx,r[0],r[1]);bt+=r[0];at+=r[1];if(r[0]+r[1]>FP[poc][0]+FP[poc][1])poc=i;});
  tot=bt+at;
  var rows=[];
  FP.forEach(function(r,i){
    var tr=document.createElement('tr');tr.tabIndex=0;if(i===poc)tr.className='poc';
    tr.innerHTML='<td class="bd"><i style="width:'+(r[0]/mx*100)+'%"></i><span>'+r[0]+'</span></td><td class="ak"><i style="width:'+(r[1]/mx*100)+'%"></i><span>'+r[1]+'</span></td>';
    tb.appendChild(tr);rows.push(tr);
    var show=function(){rows.forEach(function(o){o.classList.remove('sel');});tr.classList.add('sel');info(r);};
    tr.addEventListener('mouseenter',show);tr.addEventListener('focus',show);tr.addEventListener('click',show);
  });
  function set(id,v,cls){var e=document.getElementById(id);e.textContent=v;e.className=cls||'';}
  function info(r){var d=r[1]-r[0];set('fp-bid',r[0]);set('fp-ask',r[1]);set('fp-d',(d>0?'+':'')+d,d>0?'pos':d<0?'neg':'');var l=document.getElementById('fp-l');l.textContent='Selected price row';}
  var d0=at-bt;
  document.getElementById('fp-all').textContent='Whole candle: '+bt.toLocaleString('en-US')+' sold at the bid, '+at.toLocaleString('en-US')+' bought at the ask, delta '+(d0>0?'+':'')+d0.toLocaleString('en-US')+'.';
  info(FP[poc]);rows[poc].classList.add('sel');document.getElementById('fp-l').textContent='Point of control (boxed)';
}

/* ---------- tabs ---------- */
function tabs(){
  var tl=[].slice.call(document.querySelectorAll('[role=tab]')),ps=[].slice.call(document.querySelectorAll('[role=tabpanel]'));
  function vids(p){return[].slice.call(p.querySelectorAll('video'));}
  function sel(t,focus){
    tl.forEach(function(o){var on=o===t;o.setAttribute('aria-selected',on);o.tabIndex=on?0:-1;});
    ps.forEach(function(p){var on=p.id===t.getAttribute('aria-controls');p.classList.toggle('cur',on);p.hidden=!on;vids(p).forEach(function(v){if(on){loadV(v);if(!RM){var q=v.play();q&&q.catch&&q.catch(function(){});}}else v.pause();});});
    if(focus)t.focus();
  }
  tl.forEach(function(t,i){t.addEventListener('click',function(){sel(t);});t.addEventListener('keydown',function(e){var k=e.key,j=k==='ArrowRight'?i+1:k==='ArrowLeft'?i-1:-1;if(j>=0){e.preventDefault();sel(tl[(j+tl.length)%tl.length],true);}});});
  window.__dcTab=sel;window.__dcTabs=tl;
}
function loadV(v){var s=v.querySelector('source[data-src]');if(s){s.src=s.getAttribute('data-src');s.removeAttribute('data-src');v.preload='auto';v.load();}}

/* ---------- observers: reveal, count-up, video in view ---------- */
function observers(){
  var rv=[].slice.call(document.querySelectorAll('.zrv'));
  if(!('IntersectionObserver' in window)||RM){rv.forEach(function(e){e.classList.add('vis');});}
  else{var io=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting){e.target.classList.add('vis');io.unobserve(e.target);}});},{threshold:.12});rv.forEach(function(e){io.observe(e);});}
  var nums=[].slice.call(document.querySelectorAll('[data-count]'));
  function setN(e,v){e.textContent=Math.round(v).toLocaleString('en-US');}
  if(RM||!('IntersectionObserver' in window)){nums.forEach(function(e){setN(e,+e.getAttribute('data-count'));});}
  else{var io2=new IntersectionObserver(function(es){es.forEach(function(e){if(!e.isIntersecting)return;io2.unobserve(e.target);var el=e.target,to=+el.getAttribute('data-count'),t0=performance.now();
      (function s(t){var k=Math.min(1,(t-t0)/1100),k2=1-Math.pow(1-k,3);setN(el,to*k2);if(k<1)requestAnimationFrame(s);})(t0);});},{threshold:.6});nums.forEach(function(e){io2.observe(e);});}
  var vs=[].slice.call(document.querySelectorAll('video[data-v]'));
  if(!RM&&'IntersectionObserver' in window){var io3=new IntersectionObserver(function(es){es.forEach(function(e){var v=e.target;if(e.isIntersecting){loadV(v);var q=v.play();q&&q.catch&&q.catch(function(){});}else v.pause();});},{threshold:.3});vs.forEach(function(v){io3.observe(v);});}
}

function init(){
  tabs();footprint();observers();
  fetch('assets/images/demo-real-c/nq-15m.json').then(function(r){return r.json();}).then(function(d){bars=d.bars;hero();
    var lz=document.getElementById('lay-grid');
    if('IntersectionObserver' in window){new IntersectionObserver(function(es,o){if(es[0].isIntersecting){o.disconnect();layouts();}},{rootMargin:'300px'}).observe(lz);}else layouts();
  });
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
