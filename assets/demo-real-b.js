/* demo-real-b v2: canvas charts from a recorded NQ/ES/YM/GC/CL 15m snippet (assets/demo-real-b-bars.json), tabs, replay demo, layout demo, reveal + count-up. */
(function(){
'use strict';
var RM=window.matchMedia&&matchMedia('(prefers-reduced-motion:reduce)').matches;
document.documentElement.classList.add('js');
var UP='#03c988',DN='#e5484d',GRID='rgba(255,255,255,.055)',TXT='#8b93a0',BG='#0b0b0d';
var DATA=null,subs=[];
function $(s,r){return (r||document).querySelector(s)}
function $$(s,r){return [].slice.call((r||document).querySelectorAll(s))}

/* ---- chart renderer ---- */
function size(c){var d=Math.min(window.devicePixelRatio||1,2),r=c.getBoundingClientRect(),w=Math.max(1,Math.round(r.width)),h=Math.max(1,Math.round(r.height));
  if(c._w!==w||c._h!==h||c._d!==d){c.width=w*d;c.height=h*d;c._w=w;c._h=h;c._d=d}
  var x=c.getContext('2d');x.setTransform(c._d,0,0,c._d,0,0);return x}
function draw(c,bars,o){
  var x=size(c),W=c._w,H=c._h,N=o.n,cur=o.cur,axis=o.axis?(W<500?58:66):0,vh=o.vol?Math.round(H*.16):0,top=o.small?4:10,pb=o.small?4:16;
  x.fillStyle=BG;x.fillRect(0,0,W,H);
  var last=Math.floor(cur),t=cur-last,i0=Math.max(0,last-N-1);
  var step=(W-axis-(o.small?2:10))/N,hi=-1e9,lo=1e9,maxv=0,k,b;
  var vis=[];
  for(k=i0;k<=last&&k<bars.length;k++){b=bars[k];var f=(k===last)?t:1;
    var cl=b[1]+(b[4]-b[1])*f,h=Math.max(b[1],cl,b[1]+(b[2]-b[1])*Math.min(1,f*1.7)),l=Math.min(b[1],cl,b[1]-(b[1]-b[3])*Math.min(1,f*1.7));
    vis.push([k,b[1],h,l,cl,b[5]*f]);hi=Math.max(hi,h);lo=Math.min(lo,l);maxv=Math.max(maxv,b[5])}
  if(!vis.length)return;
  var pad=(hi-lo)*.08;hi+=pad;lo-=pad;
  o.hi=o.hi==null?hi:o.hi+(hi-o.hi)*.12;o.lo=o.lo==null?lo:o.lo+(lo-o.lo)*.12;hi=o.hi;lo=o.lo;
  var ph=H-top-pb-vh,y=function(p){return top+(hi-p)/(hi-lo)*ph};
  if(!o.small){x.font='11px "JetBrains Mono",monospace';x.textBaseline='middle';x.lineWidth=1;
    var rng=hi-lo,st=Math.pow(10,Math.floor(Math.log10(rng/5)));st*=rng/st/5>3.5?5:rng/st/5>1.6?2:1;
    for(var p=Math.ceil(lo/st)*st;p<hi;p+=st){var yy=Math.round(y(p))+.5;x.strokeStyle=GRID;x.beginPath();x.moveTo(0,yy);x.lineTo(W-axis,yy);x.stroke();
      if(axis){x.fillStyle=TXT;x.textAlign='left';x.fillText(p.toLocaleString('en-US',{maximumFractionDigits:0}),W-axis+8,yy)}}}
  var bw=Math.max(1,Math.floor(step*.68));
  for(k=0;k<vis.length;k++){b=vis[k];var xc=W-axis-(cur-b[0])*step-step/2+ (o.small?0:-2);var up=b[4]>=b[1];x.fillStyle=x.strokeStyle=up?UP:DN;
    x.lineWidth=1;var xl=Math.round(xc)+.5;x.beginPath();x.moveTo(xl,y(b[2]));x.lineTo(xl,y(b[3]));x.stroke();
    var yo=y(b[1]),yc=y(b[4]);x.fillRect(Math.round(xc-bw/2),Math.min(yo,yc),bw,Math.max(1,Math.abs(yc-yo)));
    if(vh){x.globalAlpha=.45;var vv=b[5]/maxv*vh;x.fillRect(Math.round(xc-bw/2),H-pb-vv,bw,vv);x.globalAlpha=1}}
  var lc=vis[vis.length-1][4],ly=Math.round(y(lc))+.5,col=lc>=vis[vis.length-1][1]?UP:DN;
  if(!o.small){x.setLineDash([3,4]);x.strokeStyle=col;x.globalAlpha=.7;x.beginPath();x.moveTo(0,ly);x.lineTo(W-axis,ly);x.stroke();x.setLineDash([]);x.globalAlpha=1;
    if(axis){x.fillStyle=col;x.fillRect(W-axis,ly-9,axis,18);x.fillStyle='#04110c';x.textAlign='left';x.fillText(lc.toLocaleString('en-US',W<400?{maximumFractionDigits:0}:{minimumFractionDigits:1,maximumFractionDigits:1}),W-axis+4,ly)}}
  if(o.cross&&o.mx!=null){var xx=Math.round(o.mx)+.5;x.strokeStyle='rgba(255,255,255,.25)';x.beginPath();x.moveTo(xx,0);x.lineTo(xx,H);x.stroke();
    var kk=Math.min(last,Math.max(i0,Math.round(cur-(W-axis-step/2-2-o.mx)/step)));
    var bb=bars[kk];if(bb&&o.onhover)o.onhover(bb)}
}
function load(){return fetch('assets/demo-real-b-bars.json').then(function(r){return r.json()})}
function fmtT(ts){var d=new Date(ts*1000);return d.toUTCString().slice(5,22).replace(/ (\d\d):(\d\d)$/,' $1:$2')+' UTC'}

/* ---- scheduler: one rAF, only draws visible canvases ---- */
var items=[],raf=0,lastT=0;
function reg(c,fn,fps){var it={c:c,fn:fn,vis:false,every:1000/(fps||30),last:0};items.push(it);
  if('IntersectionObserver' in window){new IntersectionObserver(function(e){it.vis=e[0].isIntersecting;kick()}).observe(c)}else it.vis=true;return it}
function kick(){if(!raf)raf=requestAnimationFrame(tick)}
function tick(t){raf=0;var any=false;for(var i=0;i<items.length;i++){var it=items[i];if(!it.vis)continue;any=true;if(t-it.last>=it.every){it.fn(t,t-it.last);it.last=t}}
  if(any&&!document.hidden)raf=requestAnimationFrame(tick)}
document.addEventListener('visibilitychange',kick);

function init(d){
  DATA=d;
  /* hero */
  var hc=$('#hero-cv');
  if(hc){var N=function(){return hc._w<500?38:70};
    var o={n:38,cur:RM?d.NQ.length-4.0:210,axis:true,vol:true,cross:true,mx:null};
    var tip=$('#hero-tip');
    o.onhover=function(b){tip.innerHTML='<b>NQ1!</b> '+fmtT(b[0])+' <i>O</i> '+b[1].toFixed(2)+' <i>H</i> '+b[2].toFixed(2)+' <i>L</i> '+b[3].toFixed(2)+' <i>C</i> '+b[4].toFixed(2)};
    var speed=.00085; // bars per ms: about one bar a second
    var it=reg(hc,function(t,dt){if(!RM){o.cur+=Math.min(dt,60)*speed;if(o.cur>=d.NQ.length-1)o.cur=130}o.n=N();draw(hc,d.NQ,o)},30);
    hc.addEventListener('pointermove',function(e){var r=hc.getBoundingClientRect();o.mx=e.clientX-r.left});
    hc.addEventListener('pointerleave',function(){o.mx=null;tip.innerHTML='<b>NQ1!</b> 15 minute bars, recorded session'});
    if(RM){o.n=N();draw(hc,d.NQ,o);window.addEventListener('resize',function(){draw(hc,d.NQ,o)});hc.addEventListener('pointermove',function(){draw(hc,d.NQ,o)})}
  }
  /* replay demo */
  var rc=$('#rp-cv');
  if(rc){var ro={n:60,cur:150,axis:true,vol:true},play=false,sl=$('#rp-sl'),pb=$('#rp-play'),rt=$('#rp-t');
    var rs=function(){ro.cur=+sl.value;rt.textContent='bar '+Math.floor(ro.cur)+' of '+(d.NQ.length-1);ro.n=rc._w<500?36:60;draw(rc,d.NQ,ro)};
    sl.max=d.NQ.length-1;sl.value=150;
    sl.addEventListener('input',function(){play=false;pb.textContent='Play';pb.setAttribute('aria-pressed','false');ro.hi=null;ro.lo=null;rs()});
    pb.addEventListener('click',function(){play=!play;pb.textContent=play?'Pause':'Play';pb.setAttribute('aria-pressed',play)});
    $('#rp-step').addEventListener('click',function(){play=false;pb.textContent='Play';sl.value=Math.min(+sl.max,Math.floor(+sl.value)+1);rs()});
    var acc=0;reg(rc,function(t,dt){if(play){acc+=dt;if(acc>260){acc=0;sl.value=Math.min(+sl.max,Math.floor(+sl.value)+1);if(+sl.value>=+sl.max){play=false;pb.textContent='Play'}}}rs()},20);
  }
  /* layout demo */
  var lay=$('#lay'),syms=['NQ','ES','YM','GC','CL'],cvs=[];
  function build(n){lay.className='lay n'+n;lay.innerHTML='';items=items.filter(function(i){return !i.lay});cvs=[];
    for(var k=0;k<n;k++){(function(k){var c=document.createElement('canvas');var s=syms[k%5];c.setAttribute('role','img');c.setAttribute('aria-label',s+'1! chart');lay.appendChild(c);
      var ox={n:n===16?26:n===4?44:70,cur:60+k*7,axis:n<=4,small:n===16,vol:false};var arr=d[s],base=arr.length-1;
      var it=reg(c,function(t,dt){if(!RM)ox.cur+=Math.min(dt,80)*.0006;if(ox.cur>=arr.length-1)ox.cur=60;draw(c,arr,ox)},n===16?12:20);it.lay=true})(k)}
    kick()}
  $$('#lay-seg button').forEach(function(b){b.addEventListener('click',function(){$$('#lay-seg button').forEach(function(x){x.setAttribute('aria-pressed','false')});b.setAttribute('aria-pressed','true');build(+b.dataset.n)})});
  build(4);
  kick();
}

/* ---- tabs ---- */
function tabs(){var bs=$$('#tabs [role=tab]');bs.forEach(function(b,i){
  b.addEventListener('click',function(){bs.forEach(function(x){x.setAttribute('aria-selected',x===b);x.tabIndex=x===b?0:-1;$('#'+x.getAttribute('aria-controls')).classList.toggle('on',x===b)})});
  b.addEventListener('keydown',function(e){var j=e.key==='ArrowRight'?i+1:e.key==='ArrowLeft'?i-1:-1;if(j>=0){bs[(j+bs.length)%bs.length].focus();bs[(j+bs.length)%bs.length].click()}})})}
/* ---- reveal + count up ---- */
function reveal(){var els=$$('.rv');if(!('IntersectionObserver' in window)||RM){els.forEach(function(e){e.classList.add('in')});return}
  var io=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting){e.target.classList.add('in');io.unobserve(e.target)}})},{rootMargin:'0px 0px -8% 0px'});els.forEach(function(e){io.observe(e)})}
function counts(){$$('[data-count]').forEach(function(el){var to=+el.dataset.count;if(RM||!('IntersectionObserver' in window)){el.textContent=to.toLocaleString('en-US');return}
  el.textContent='0';var io=new IntersectionObserver(function(e){if(!e[0].isIntersecting)return;io.disconnect();var t0=performance.now();(function f(t){var p=Math.min(1,(t-t0)/1100),v=Math.round(to*(1-Math.pow(1-p,3)));el.textContent=v.toLocaleString('en-US');if(p<1)requestAnimationFrame(f)})(t0)});io.observe(el)})}
tabs();reveal();counts();
load().then(init).catch(function(){});
})();
