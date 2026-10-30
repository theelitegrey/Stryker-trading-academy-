// MOCK ONLY. Takes the real rendered sidebar and applies the proposed options in the DOM.
(function(){
 setTimeout(function(){
  var q=new URLSearchParams(location.search), v=q.get('v')||'now';
  var o={};
  if(v==='123')o={1:1,2:1,3:1};
  if(v==='1234')o={1:1,2:1,3:1,4:1};
  if(v==='1235')o={1:1,2:1,3:1,5:1};
  if(v==='all')o={1:1,2:1,3:1,4:1,5:1};
  var mobile=innerWidth<=900;
  var sb=document.querySelector('.sidebar'); if(mobile) sb.classList.add('mobile-open');
  window.dispatchEvent(new Event('cn:route'));
  var sec=document.getElementById('cn-section');
  var CH='<svg class="m-chev" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>';
  function link(k){return sec.querySelector('[data-cn="'+k+'"]');}
  function setText(a,t){Array.from(a.childNodes).forEach(function(n){if(n.nodeType===3&&n.textContent.trim())n.textContent=t;});}
  if(o[2]){ var mi=link('mine'); if(mi)mi.remove(); var ex=link('explore'); setText(ex,'Communities'); ex.setAttribute('data-cn','communities'); }
  if(o[3]){ var h=link('how'); if(h)h.remove(); }
  if(o[1]){
    var d=link('dash'); var sub=sec.querySelector('.side-sublabel');
    setText(d,'Manage Richard NQ'); d.href='/creator?c=richard-nq'; d.insertAdjacentHTML('beforeend',CH);
    if(sub){ while(sub.nextSibling){sub.nextSibling.remove();} sub.remove(); }
  }
  if(o[5]) document.body.classList.add('m-tight');
  if(o[4]){
    document.querySelectorAll('.sidebar .side-section').forEach(function(s){
      var lab=s.querySelector('.side-label'); if(!lab)return;
      var b=document.createElement('button'); b.type='button'; b.className='m-fold'; b.setAttribute('aria-expanded','true');
      var n=s.querySelectorAll('.side-link').length;
      b.innerHTML='<span>'+lab.textContent+'</span><span class="m-count">'+n+'</span>'+CH;
      lab.replaceWith(b);
      b.addEventListener('click',function(){var f=s.classList.toggle('m-folded');b.setAttribute('aria-expanded',String(!f));});
    });
    if(q.get('fold')==='community'){
      document.querySelectorAll('.m-fold').forEach(function(b){if(/^Community/.test(b.textContent))b.click();});
    }
  }
  var vis=0,cr=0;
  sb.querySelectorAll('.side-link').forEach(function(r){if(r.offsetHeight>0){vis++; if(sec.contains(r))cr++;}});
  document.title='rows='+vis+' creator='+cr+' sidebarH='+sb.scrollHeight;
 },500);
})();
