// Stryker Trading Academy — native GEX dashboard
// Depends on: Cloudflare Pages Functions under /api/gex/* and a canvas element.
(function(){
  var MKTS = ['SPX', 'SPY', 'QQQ', 'GLD'];
  var DTES = [{v:0,l:'0DTE'}, {v:1,l:'1DTE'}, {v:7,l:'1W'}, {v:30,l:'1M'}];
  var IVS = ['1m', '5m', '15m', '1h'];
  var cur = 'SPX', curDte = 1, curIv = '5m', curFut = null, DATA = null, CANDLES = [];
  var showMkt = true;

  function $(id){ return document.getElementById(id); }
  function esc(s){ return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
  function fmt(n,d){ if(n == null || !isFinite(n)) return '—'; return Number(n).toLocaleString(undefined,{minimumFractionDigits:d == null ? 2 : d, maximumFractionDigits:d == null ? 2 : d}); }
  function bfmt(n){ if(n == null || !isFinite(n)) return '—'; return (n/1e9).toFixed(2) + 'B'; }
  function money(n){ if(n == null || !isFinite(n)) return '—'; return '$' + Math.abs(n).toLocaleString(undefined,{maximumFractionDigits:0}); }
  function cls(on){ return on ? ' is-on' : ''; }

  function wireTabs(){
    $('gex-tabs').innerHTML = MKTS.map(function(m){ return '<button class="gex-tab'+cls(m === cur)+'" data-m="'+m+'">'+m+'</button>'; }).join('');
    $('gex-dtes').innerHTML = DTES.map(function(d){ return '<button class="gex-dte'+cls(d.v === curDte)+'" data-d="'+d.v+'">'+d.l+'</button>'; }).join('');
    $('gex-ivs').innerHTML = IVS.map(function(i){ return '<button class="gex-iv'+cls(i === curIv)+'" data-i="'+i+'">'+i+'</button>'; }).join('');
    $('gex-tabs').addEventListener('click', function(e){ var m=e.target.dataset.m; if(!m) return; cur=m; curFut=null; paintButtons(); loadLevels(); });
    $('gex-dtes').addEventListener('click', function(e){ var d=e.target.dataset.d; if(d == null) return; curDte=Number(d); paintButtons(); loadLevels(); });
    $('gex-ivs').addEventListener('click', function(e){ var i=e.target.dataset.i; if(!i) return; curIv=i; paintButtons(); loadChart(); });
    $('gex-futs').addEventListener('click', function(e){ var f=e.target.dataset.f; if(!f || !DATA) return; curFut=f; render(DATA); loadChart(); });
    $('gex-toggle-market').addEventListener('click', function(){ showMkt = !showMkt; $('gex-toggle-market').textContent = 'Market levels: ' + (showMkt ? 'ON' : 'OFF'); drawChart(); });
    window.addEventListener('resize', drawChart, {passive:true});
  }

  function paintButtons(){
    document.querySelectorAll('.gex-tab').forEach(function(b){ b.classList.toggle('is-on', b.dataset.m === cur); });
    document.querySelectorAll('.gex-dte').forEach(function(b){ b.classList.toggle('is-on', Number(b.dataset.d) === curDte); });
    document.querySelectorAll('.gex-iv').forEach(function(b){ b.classList.toggle('is-on', b.dataset.i === curIv); });
  }

  async function getJson(url){
    var res = await fetch(url, {cache:'no-store'});
    var text = await res.text();
    var data;
    try { data = JSON.parse(text); } catch(e) { throw new Error('bad response'); }
    if(!res.ok || data.error) throw new Error(data.error || ('HTTP ' + res.status));
    return data;
  }

  async function loadLevels(){
    $('gex-status-text').innerHTML = '<b>Loading '+esc(cur)+'…</b><span> Building gamma walls, futures conversion and market-generated levels on strykertrading.com.</span>';
    try{
      var d = await getJson('/api/gex/levels/' + encodeURIComponent(cur) + '?dte=' + curDte + '&t=' + Date.now());
      DATA = d;
      var futs = Object.keys(d.futures || {}).filter(function(k){ return !(d.futures[k] || {}).error; });
      if(!curFut || futs.indexOf(curFut) === -1) curFut = futs[0] || null;
      render(d);
      if(curFut) loadChart();
    }catch(e){
      $('gex-status-text').innerHTML = '<b class="gex-error">GEX API error</b><span> '+esc(e.message)+'</span>';
      $('gex-levels').innerHTML = '<p class="gex-error">'+esc(e.message)+'</p>';
    }
  }

  function render(d){
    var pos = d.regime === 'POSITIVE';
    var dteLabel = (DTES.find(function(x){return x.v===curDte;}) || {}).l || (curDte + 'DTE');
    var futs = Object.keys(d.futures || {}).filter(function(k){ return !(d.futures[k] || {}).error; });
    var F = curFut ? d.futures[curFut] : null;
    $('gex-status-text').innerHTML = '<b>'+esc(d.underlying)+' → '+esc(futs.join(' / ') || d.fut)+'</b><span> '+esc(String(d.contracts))+' contracts · '+esc(dteLabel)+(d.expiry?' · exp '+esc(d.expiry):'')+' · Cboe delayed '+esc(d.asof || '')+'</span>';
    $('gex-futs').innerHTML = futs.length ? futs.map(function(f){ return '<button class="gex-fut'+cls(f === curFut)+'" data-f="'+f+'">'+f+'</button>'; }).join('') : '<span class="gex-empty">futures feed unavailable</span>';
    $('gex-hero').innerHTML = '<div class="gex-spot"><small>SPOT '+esc(d.underlying)+'</small>'+fmt(d.spot,2)+'</div>'+
      '<div class="gex-badge '+(pos?'pos':'neg')+'">'+esc(d.regime)+' GAMMA</div>'+
      '<div class="gex-kv">NET GEX<b style="color:'+(pos?'var(--bull)':'var(--bear)')+'">'+bfmt(d.net_gex)+'</b></div>'+
      '<div class="gex-kv">IV30<b>'+fmt(d.iv30,1)+'%</b></div>'+
      (F ? '<div class="gex-kv">'+esc(curFut)+' LAST<b>'+fmt(F.futures_price,2)+'</b></div>' : '');
    renderWarnings(d);
    renderLevels(d, F);
    renderMarket(d, F);
    renderLadder(d, F);
    drawChart();
  }

  function renderWarnings(d){
    var W = (d.warnings || []).slice();
    $('gex-warnings').innerHTML = W.map(function(w){ return '<div class="gex-warning"><b>'+esc((w.level || 'info').toUpperCase())+'</b><div>'+esc(w.msg || '')+'</div></div>'; }).join('');
  }

  function levelRows(d, F){
    return [
      ['call','CALL WALL',d.call_wall,'call_wall'],
      ['zero','ZERO GAMMA',d.zero_gamma,'zero_gamma'],
      ['spot','◆ SPOT',d.spot,'spot'],
      ['put','PUT WALL',d.put_wall,'put_wall']
    ].filter(function(r){ return r[2] != null; }).sort(function(a,b){ return b[2] - a[2]; }).map(function(r){
      var idx = r[2], fpx = F && F.levels ? F.levels[r[3]] : null, fs = F && F.levels ? F.levels.spot : null;
      var dpts = fpx != null && fs != null ? fpx - fs : null;
      var dpct = ((idx - d.spot) / d.spot * 100);
      var usd = dpts != null && F ? Math.abs(dpts) * F.point_value : null;
      return '<div class="gex-level '+r[0]+'"><div class="nm">'+r[1]+'</div><div class="px">'+fmt(idx,2)+'</div><div class="fut">'+esc(curFut || '')+' '+(fpx!=null?fmt(fpx,2):'—')+'</div><div class="dist">'+(dpts!=null?((dpts>=0?'+':'')+dpts.toFixed(1)+'pt'):((dpct>=0?'+':'')+dpct.toFixed(2)+'%'))+'</div><div class="usd">'+(usd!=null?money(usd):'')+'</div></div>';
    }).join('');
  }

  function renderLevels(d, F){
    $('gex-levels').innerHTML = levelRows(d, F);
    var e = d.expected || {}, r68 = e['68%'] || [], r80 = e['80%'] || [];
    var FL = F && F.levels;
    $('gex-ranges').innerHTML = '<div class="gex-range"><span>IV EXPECTED RANGE 68% '+esc(curFut || '')+'</span>'+(FL?fmt(FL.iv68_lo,2)+' – '+fmt(FL.iv68_hi,2):fmt(r68[0],2)+' – '+fmt(r68[1],2))+'</div>'+
      '<div class="gex-range"><span>80% '+esc(curFut || '')+'</span>'+(FL?fmt(FL.iv80_lo,2)+' – '+fmt(FL.iv80_hi,2):fmt(r80[0],2)+' – '+fmt(r80[1],2))+'</div>';
    $('gex-play').innerHTML = d.regime === 'POSITIVE'
      ? '<b>Positive regime playbook.</b> Dealers are long gamma: expect mean reversion and pinning between the major walls. Fade extremes first; treat loss of zero gamma as the regime flip.'
      : '<b>Negative regime playbook.</b> Dealers are short gamma: hedging can amplify direction. Trade momentum through levels, widen stops, and size down until zero gamma is reclaimed.';
  }

  function renderMarket(d, F){
    var S = (d.session || {})[curFut];
    if(!S || S.error){ $('gex-market').innerHTML = '<p class="gex-empty">'+esc(S && S.error || 'no session data')+'</p>'; return; }
    var fs = F && F.levels ? F.levels.spot : null;
    function c(label,val,klass){
      if(val == null) return '';
      var dist = fs != null ? val - fs : null;
      var usd = dist != null && F ? Math.abs(dist) * F.point_value : null;
      return '<div class="gex-mkc '+klass+'"><span>'+label+'</span><b>'+fmt(val,2)+'</b>'+(dist!=null?'<small>'+((dist>=0?'+':'')+dist.toFixed(1))+'pt'+(usd!=null?' · '+money(usd):'')+'</small>':'')+'</div>';
    }
    $('gex-market').innerHTML = '<div class="gex-market-grid">'+
      c('PRIOR VAH',S.prior_vah,'va')+c('PRIOR POC',S.prior_poc,'va')+c('PRIOR VAL',S.prior_val,'va')+
      c('PRIOR RTH HIGH',S.prior_rth_high,'rth')+c('PRIOR RTH LOW',S.prior_rth_low,'rth')+c('PRIOR CLOSE',S.prior_close,'rth')+
      c('OVERNIGHT HIGH',S.overnight_high,'on')+c('OVERNIGHT LOW',S.overnight_low,'on')+c('RTH OPEN',S.rth_open,'rth')+c('RTH HIGH',S.rth_high,'rth')+c('RTH LOW',S.rth_low,'rth')+
      '</div><p class="gex-empty" style="margin-top:10px">'+esc(curFut)+' · prior session '+esc(S.prior_session || '—')+' · '+(S.volume_based?'volume':'TPO/time')+'-based 70% value area</p>';
  }

  function renderLadder(d, F){
    var rows = d.ladder || [];
    if(!rows.length){ $('gex-ladder').innerHTML = '<p class="gex-empty">No strike profile available.</p>'; return; }
    var mx = Math.max.apply(null, rows.map(function(r){ return Math.abs(r.gex || 0); })) || 1;
    var html = '<div class="gex-ladder-wrap"><table class="gex-table"><tr><th>STRIKE</th><th>'+(curFut || 'FUT')+'</th><th>NET GEX</th><th>PROFILE</th><th>NET DEX</th><th>OI</th></tr>';
    rows.forEach(function(r){
      var near = Math.abs(r.strike - d.spot) < (d.spot * 0.0015);
      var fv = F ? r.strike * F.ratio + F.basis : null;
      var w = Math.max(2, Math.abs(r.gex || 0) / mx * 100);
      html += '<tr class="'+(near?'here':'')+'"><td>'+fmt(r.strike, r.strike > 2000 ? 0 : 1)+'</td><td>'+ (fv!=null?fmt(fv, fv > 2000 ? 0 : 1):'—')+'</td><td style="color:'+(r.gex>0?'var(--bull)':'var(--bear)')+'">'+bfmt(r.gex)+'</td><td><span class="gex-bar '+(r.gex>0?'pos':'neg')+'" style="width:'+w+'%"></span></td><td>'+bfmt(r.dex)+'</td><td>'+Number(r.oi || 0).toLocaleString()+'</td></tr>';
    });
    $('gex-ladder').innerHTML = html + '</table></div>';
  }

  async function loadChart(){
    if(!curFut) return;
    $('gex-chart-title').textContent = curFut + ' · ' + curIv + ' · GAMMA LEVELS';
    try{
      var d = await getJson('/api/gex/candles/' + encodeURIComponent(curFut) + '?interval=' + encodeURIComponent(curIv) + '&t=' + Date.now());
      CANDLES = d.candles || [];
      drawChart();
    }catch(e){
      CANDLES = [];
      drawChart(e.message);
    }
  }

  function drawChart(err){
    var canvas = $('gex-chart');
    if(!canvas) return;
    var wrap = canvas.parentElement, rect = wrap.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    canvas.style.width = rect.width + 'px'; canvas.style.height = rect.height + 'px';
    var ctx = canvas.getContext('2d'); ctx.setTransform(dpr,0,0,dpr,0,0);
    var w = rect.width, h = rect.height, padL = 12, padR = 84, padT = 18, padB = 28;
    ctx.clearRect(0,0,w,h);
    ctx.fillStyle = '#050608'; ctx.fillRect(0,0,w,h);
    if(err){ label(ctx, err, 20, 30, 'var(--bear)'); return; }
    if(!CANDLES.length){ label(ctx, 'loading chart…', 20, 30, '#8b949e'); return; }
    var n = Math.min(CANDLES.length, Math.floor((w - padL - padR) / 5));
    var data = CANDLES.slice(-Math.max(30,n));
    var vals = [];
    data.forEach(function(c){ vals.push(c.high, c.low); });
    var lines = collectLines(); lines.forEach(function(l){ if(l.price != null) vals.push(l.price); });
    var min = Math.min.apply(null, vals), max = Math.max.apply(null, vals), span = max - min || 1;
    min -= span * .08; max += span * .08; span = max - min;
    function y(v){ return padT + (max - v) / span * (h - padT - padB); }
    function x(i){ return padL + i * ((w - padL - padR) / Math.max(1, data.length - 1)); }
    ctx.strokeStyle = 'rgba(255,255,255,.055)'; ctx.lineWidth = 1;
    for(var g=0; g<5; g++){ var gy = padT + g*(h-padT-padB)/4; ctx.beginPath(); ctx.moveTo(padL,gy); ctx.lineTo(w-padR,gy); ctx.stroke(); }
    data.forEach(function(c,i){
      var xx=x(i), body=Math.max(2, Math.abs(y(c.open)-y(c.close))), top=Math.min(y(c.open), y(c.close));
      var up = c.close >= c.open, col = up ? '#03c988' : '#e5484d';
      ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(xx, y(c.high)); ctx.lineTo(xx, y(c.low)); ctx.stroke();
      ctx.fillRect(xx-2.5, top, 5, body);
    });
    lines.forEach(function(l){ drawLine(ctx, y(l.price), padL, w-padR, l); });
    ctx.fillStyle = '#8b949e'; ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace'; ctx.textAlign='right';
    for(var t=0;t<5;t++){ var pv=max - t*span/4; ctx.fillText(fmt(pv,2), w-10, padT + t*(h-padT-padB)/4 + 3); }
  }

  function label(ctx, text, x, y, color){ ctx.fillStyle = color || '#8b949e'; ctx.font = '12px ui-monospace, SFMono-Regular, Menlo, monospace'; ctx.fillText(text, x, y); }
  function drawLine(ctx, y, x1, x2, l){
    if(y == null || !isFinite(y)) return;
    ctx.save(); ctx.strokeStyle = l.color; ctx.lineWidth = l.width || 1.5; if(l.dash) ctx.setLineDash(l.dash);
    ctx.beginPath(); ctx.moveTo(x1,y); ctx.lineTo(x2,y); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = l.color; ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace'; ctx.textAlign = 'left'; ctx.fillText(l.title, x2 + 6, y + 3);
    ctx.restore();
  }
  function collectLines(){
    if(!DATA || !curFut) return [];
    var F = DATA.futures && DATA.futures[curFut]; if(!F || F.error) return [];
    var L = F.levels || {}, out = [];
    function add(price,color,title,dash,width){ if(price != null) out.push({price:price,color:color,title:title,dash:dash,width:width}); }
    add(L.call_wall,'#ef4444','CALL WALL',null,2); add(L.zero_gamma,'#f59e0b','ZERO GAMMA',[6,5],1.5); add(L.put_wall,'#22c55e','PUT WALL',null,2);
    add(L.iv68_hi,'#8b7cf6','IV +68%',[2,4],1); add(L.iv68_lo,'#8b7cf6','IV -68%',[2,4],1);
    if(showMkt){ var S=(DATA.session||{})[curFut]; if(S && !S.error){ add(S.prior_vah,'#38bdf8','pVAH',[6,4],1); add(S.prior_poc,'#38bdf8','pPOC',null,1); add(S.prior_val,'#38bdf8','pVAL',[6,4],1); add(S.overnight_high,'#64748b','ONH',[2,4],1); add(S.overnight_low,'#64748b','ONL',[2,4],1); } }
    return out;
  }

  document.addEventListener('DOMContentLoaded', function(){ wireTabs(); loadLevels(); setInterval(loadLevels, 60000); setInterval(loadChart, 60000); });
})();
