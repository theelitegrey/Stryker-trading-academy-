// Homepage nav: Products menu close-on-outside, mobile menu, theme button, signed-in swap. Depends on theme.js (toggleStrykerTheme) and auth.js (auth).
(function(){
  function ready(f){ document.readyState==='loading'?document.addEventListener('DOMContentLoaded',f):f(); }
  ready(function(){
    var tg=document.getElementById('hn-tog'), ln=document.getElementById('hn-links'), pd=document.querySelector('.hn-prod'), th=document.getElementById('theme');
    if(th) th.addEventListener('click',function(){ if(window.toggleStrykerTheme) window.toggleStrykerTheme(); });
    if(tg) tg.addEventListener('click',function(){ var o=ln.classList.toggle('open'); tg.setAttribute('aria-expanded',o); });
    if(ln) ln.addEventListener('click',function(e){ if(e.target.closest&&e.target.closest('a')&&ln.classList.contains('open')){ ln.classList.remove('open'); if(tg) tg.setAttribute('aria-expanded','false'); } });
    document.addEventListener('click',function(e){ if(pd&&pd.open&&!pd.contains(e.target)) pd.open=false; });
    // Owner 14 Nov: Products opens on hover on desktop (mouse); click/tap still toggles. Short close delay so the pointer can reach the menu.
    if(pd && window.matchMedia && window.matchMedia('(hover:hover) and (pointer:fine)').matches){
      var ht=null, wide=function(){ return window.innerWidth>=900; };
      pd.addEventListener('mouseenter',function(){ if(!wide()) return; clearTimeout(ht); var m=pd.querySelector('.hn-menu'); if(m) m.classList.remove('mh-out'); ht=setTimeout(function(){ pd.open=true; },80); });
      pd.addEventListener('mouseleave',function(){ if(!wide()) return; clearTimeout(ht); ht=setTimeout(function(){ var m=pd.querySelector('.hn-menu'); if(m&&pd.open&&!matchMedia('(prefers-reduced-motion: reduce)').matches){ m.classList.add('mh-out'); ht=setTimeout(function(){ m.classList.remove('mh-out'); pd.open=false; },100); } else pd.open=false; },180); });
    }
    document.addEventListener('keydown',function(e){ if(e.key==='Escape'){ if(pd) pd.open=false; if(ln){ ln.classList.remove('open'); if(tg) tg.setAttribute('aria-expanded','false'); } } });
    if(ln) ln.addEventListener('click',function(e){ if(e.target.closest('a')){ ln.classList.remove('open'); if(tg) tg.setAttribute('aria-expanded','false'); } });
    // Signed-in visitors see Dashboard instead of Log in / Start free (same signal as auth.js publicNavAuthState).
    var cta=document.querySelector('.hn-cta'); if(!cta) return;
    var login=cta.querySelector('.hn-login'), start=cta.querySelector('a[href="/signup"]'), dash=document.createElement('a');
    dash.href='/dashboard-user'; dash.className='btn btn-primary btn-sm'; dash.textContent='Dashboard'; dash.hidden=true; cta.insertBefore(dash,login||document.getElementById('hn-tog'));
    function paint(on){ dash.hidden=!on; if(login) login.style.display=on?'none':''; if(start) start.style.display=on?'none':''; }
    try{ paint(localStorage.getItem('stryker_nav_signed_in')==='1'); }catch(e){}
    if(typeof auth!=='undefined'&&auth) auth.onAuthStateChanged(function(u){ paint(!!u); });
  });
})();
