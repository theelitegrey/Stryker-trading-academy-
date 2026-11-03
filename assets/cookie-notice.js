/* Cookie notice. Honest notice: only essential storage is used (sign-in, settings).
   Choice lives in localStorage tz_consent; read it with window.tzConsent.get(),
   listen for the 'tz:consent' event. Future analytics must check analytics===true. */
(function(){
  'use strict';
  var V=1,KEY='tz_consent';
  function get(){try{var o=JSON.parse(localStorage.getItem(KEY));return o&&o.v===V?o:null}catch(e){return null}}
  function save(){var o={v:V,essential:true,analytics:false,at:new Date().toISOString()};
    try{localStorage.setItem(KEY,JSON.stringify(o))}catch(e){}
    try{window.dispatchEvent(new CustomEvent('tz:consent',{detail:o}))}catch(e){}return o}
  window.tzConsent={get:get};
  if(window.self!==window.top||get())return;
  if(/^\/(overlay|stream-overlay|terminal)(\.html)?$/.test(location.pathname))return;
  var css='.tzc{position:fixed;z-index:2147483000;left:12px;right:12px;bottom:calc(12px + env(safe-area-inset-bottom));max-width:420px;box-sizing:border-box;padding:14px 16px;border-radius:16px;'+''
  +'background:rgba(19,19,22,.78);-webkit-backdrop-filter:blur(18px) saturate(1.4);backdrop-filter:blur(18px) saturate(1.4);border:1px solid rgba(255,255,255,.09);box-shadow:0 12px 40px rgba(0,0,0,.45);'
  +'color:#c9cdd3;font:13px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;opacity:0;transform:translateY(16px);transition:opacity .25s ease,transform .25s ease}'
  +'.tzc.on{opacity:1;transform:none}.tzc.off{opacity:0;transform:translateY(16px)}'
  +'html[data-theme=light] .tzc{background:rgba(255,255,255,.82);border-color:rgba(14,22,33,.1);box-shadow:0 12px 40px rgba(14,22,33,.16);color:#2a3543}'
  +'.tzc-r{display:flex;gap:12px;align-items:flex-start}.tzc svg{flex:none;width:20px;height:20px;margin-top:1px;color:#03c988}'
  +'.tzc p{margin:0;flex:1}.tzc-b{display:flex;gap:4px;justify-content:flex-end;margin-top:8px}'
  +'.tzc button,.tzc a.tzc-l{min-height:44px;min-width:44px;box-sizing:border-box;padding:0 16px;border-radius:12px;border:0;font:600 13.5px system-ui,-apple-system,sans-serif;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;text-decoration:none}'
  +'.tzc .ok{background:#03c988;color:#04150e}.tzc .ok:hover{background:#4fe3ac}'
  +'.tzc .dt{background:transparent;color:inherit;opacity:.85}.tzc .dt:hover{opacity:1;background:rgba(127,127,127,.14)}'
  +'.tzc button:focus-visible,.tzc a:focus-visible{outline:2px solid #03c988;outline-offset:2px}'
  +'.tzc-d{margin:10px 0 0;padding:0;list-style:none;font-size:13px;border-top:1px solid rgba(127,127,127,.2)}'
  +'.tzc-d li{padding:8px 0;border-bottom:1px solid rgba(127,127,127,.14)}.tzc-d b{color:inherit}'
  +'.tzc a.tzc-l{color:#03c988;padding:0;justify-content:flex-start}'
  +'@media(min-width:700px){.tzc{right:auto;left:20px;bottom:20px}}'
  +'body:has(.sidebar.mobile-open) .tzc.on,body.sidebar-locked .tzc.on{opacity:0;pointer-events:none;transform:translateY(16px)}'
  +'@media(max-width:820px){body.nav-authed .tzc,body.has-appdock .tzc{bottom:calc(84px + env(safe-area-inset-bottom))}}'
  +'body:has(#appnav-sheet.open) .tzc.on,body:has([role=dialog][aria-modal=true]:not(.tzc-d)) .tzc.on,body:has(.stk-ct-ov) .tzc.on{opacity:0;pointer-events:none}'
  +'@media(prefers-reduced-motion:reduce){.tzc{transition:none;transform:none}}';
  function show(){
    if(document.querySelector('.tzc'))return;
    var s=document.createElement('style');s.textContent=css;document.head.appendChild(s);
    var d=document.createElement('div');d.className='tzc';d.setAttribute('role','region');d.setAttribute('aria-label','Cookie notice');if(/^\/charts/.test(location.pathname))d.style.bottom='calc(64px + env(safe-area-inset-bottom))';
    d.innerHTML='<div class="tzc-r"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3a9 9 0 1 0 9 9 4 4 0 0 1-4-4 4 4 0 0 1-5-5z"/><circle cx="9" cy="10" r=".8" fill="currentColor"/><circle cx="14" cy="15" r=".8" fill="currentColor"/><circle cx="8.5" cy="15" r=".8" fill="currentColor"/></svg>'
    +'<p>We use only essential cookies to keep you signed in and remember your settings. No ads, no tracking.</p></div>'
    +'<ul class="tzc-d" id="tzc-d" hidden><li><b>Essential:</b> always on (sign-in, your settings)</li><li><b>Analytics:</b> off. We don\'t use any right now.</li><li><a class="tzc-l" href="/cookies">Cookie policy</a></li></ul>'
    +'<div class="tzc-b"><button type="button" class="dt" aria-expanded="false" aria-controls="tzc-d">Details</button><button type="button" class="ok">OK</button></div>';
    document.body.appendChild(d);
    var dt=d.querySelector('.dt'),ul=d.querySelector('.tzc-d');
    function close(){save();document.removeEventListener('keydown',key);d.classList.remove('on');d.classList.add('off');setTimeout(function(){d.remove();s.remove()},300)}
    function key(e){if(e.key==='Escape')close()}
    d.querySelector('.ok').onclick=close;
    dt.onclick=function(){var o=ul.hidden;ul.hidden=!o;dt.setAttribute('aria-expanded',o);dt.textContent=o?'Hide':'Details'};
    document.addEventListener('keydown',key);
    requestAnimationFrame(function(){requestAnimationFrame(function(){d.classList.add('on')})});
  }
  function idle(){setTimeout(show,Math.max(0,1200-performance.now()))}
  if(document.readyState==='complete')idle();else window.addEventListener('load',idle);
})();
