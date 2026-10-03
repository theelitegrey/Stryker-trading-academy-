// Stryker Trading Academy — native GEX dashboard
// Depends on: Cloudflare Pages Functions under /api/gex/* and a canvas element.
(function(){
  var MKTS = ['SPX', 'SPY', 'QQQ', 'GLD'];
  var DTES = [{v:0,l:'0DTE'}, {v:1,l:'1DTE'}, {v:7,l:'1W'}, {v:30,l:'1M'}];
  var IVS = ['1m', '5m', '15m', '1h'];
  var cur = 'SPX', curDte = 1, curIv = '5m', curFut = null, DATA = null, CANDLES = [];
  var viewFrom = 0, viewTo = 0;
  var showMkt = true;
  var tvChart = null, tvSeries = null, tvPriceLines = [], tvBarSpacing = 7;

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
    function bindZoom(id, fn){ var b=$(id); if(b){ b.onclick = fn; } }
    bindZoom('gex-zoom-in', function(e){ if(e) e.preventDefault(); tvZoom(0.72); });
    bindZoom('gex-zoom-out', function(e){ if(e) e.preventDefault(); tvZoom(1.38); });
    bindZoom('gex-zoom-reset', function(e){ if(e) e.preventDefault(); tvReset(); });
    window.addEventListener('resize', function(){ if(tvChart) tvChart.resize($('gex-chart').clientWidth, $('gex-chart').clientHeight); }, {passive:true});
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

  function ensureTradingViewChart(){
    var host = $('gex-chart');
    if(!host || tvChart) return;
    if(!window.LightweightCharts){ host.innerHTML = '<div class="gex-chart-fallback">TradingView chart library failed to load.</div>'; return; }
    tvChart = LightweightCharts.createChart(host, {
      autoSize: true,
      layout: { background: { color: '#050608' }, textColor: '#8b949e', fontFamily: 'ui-monospace,SFMono-Regular,Menlo,monospace' },
      grid: { vertLines: { color: 'rgba(255,255,255,.045)' }, horzLines: { color: 'rgba(255,255,255,.055)' } },
      rightPriceScale: { borderColor: 'rgba(255,255,255,.10)', scaleMargins: { top: .12, bottom: .15 } },
      timeScale: { borderColor: 'rgba(255,255,255,.10)', timeVisible: true, secondsVisible: false, rightOffset: 8, barSpacing: 7, minBarSpacing: 2 },
      crosshair: {
        mode: LightweightCharts.CrosshairMode.Normal,
        vertLine: { color: '#03c988', labelBackgroundColor: '#03c988' },
        horzLine: { color: '#03c988', labelBackgroundColor: '#03c988' }
      },
      handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: true },
      handleScale: { axisPressedMouseMove: true, mouseWheel: true, pinch: true },
      localization: { locale: 'en-US' }
    });
    tvSeries = tvChart.addCandlestickSeries({
      upColor: '#03c988', downColor: '#e5484d', borderUpColor: '#03c988', borderDownColor: '#e5484d', wickUpColor: '#03c988', wickDownColor: '#e5484d'
    });
    tvChart.timeScale().subscribeVisibleLogicalRangeChange(updateChartRangeLabel);
    lockChartTouchGestures(host);
  }

  function lockChartTouchGestures(host){
    if(!host || host.dataset.touchLocked === '1') return;
    host.dataset.touchLocked = '1';
    var lastX = null, lastDist = null;
    function dist(t){ var dx=t[0].clientX-t[1].clientX, dy=t[0].clientY-t[1].clientY; return Math.sqrt(dx*dx+dy*dy); }
    host.addEventListener('touchstart', function(e){
      if(e.cancelable) e.preventDefault();
      if(e.touches.length === 1){ lastX = e.touches[0].clientX; lastDist = null; }
      else if(e.touches.length >= 2){ lastDist = dist(e.touches); lastX = null; }
    }, {passive:false});
    host.addEventListener('touchmove', function(e){
      if(e.cancelable) e.preventDefault();
      if(!CANDLES.length) return;
      if(e.touches.length >= 2){
        var d = dist(e.touches);
        if(lastDist){ tvZoom(lastDist / d); }
        lastDist = d;
        return;
      }
      if(e.touches.length === 1 && lastX != null){
        var x = e.touches[0].clientX;
        var dx = x - lastX;
        if(Math.abs(dx) >= 6){ tvPan(-dx / 7); lastX = x; }
      }
    }, {passive:false});
    host.addEventListener('touchend', function(){ lastX = null; lastDist = null; }, {passive:true});
  }

  function clampIdx(i){ return Math.max(0, Math.min(CANDLES.length - 1, Math.round(i))); }

  function clampIdx(i){ return Math.max(0, Math.min(CANDLES.length - 1, Math.round(i))); }

  function ensureView(){
    if(!CANDLES.length) return;
    if(viewTo <= viewFrom || viewTo >= CANDLES.length){
      viewTo = CANDLES.length - 1;
      viewFrom = Math.max(0, viewTo - 70);
    }
  }

  function applyView(){
    if(!tvSeries || !CANDLES.length) return;
    ensureView();
    tvSeries.setData(CANDLES.slice(viewFrom, viewTo + 1));
    renderPriceLines();
    tvChart.timeScale().fitContent();
    updateChartRangeLabel();
  }

  function tvZoom(factor){
    if(!tvChart || !CANDLES.length) return;
    ensureView();
    var mid = (viewFrom + viewTo) / 2;
    var span = Math.max(12, Math.min(CANDLES.length - 1, (viewTo - viewFrom) * factor));
    viewFrom = clampIdx(mid - span / 2);
    viewTo = clampIdx(mid + span / 2);
    if(viewTo <= viewFrom) viewTo = Math.min(CANDLES.length - 1, viewFrom + 12);
    applyView();
  }

  function tvPan(deltaBars){
    if(!tvChart || !CANDLES.length) return;
    ensureView();
    var span = viewTo - viewFrom;
    var shift = Math.round(deltaBars);
    if(!shift) return;
    viewFrom = clampIdx(viewFrom + shift);
    viewTo = viewFrom + span;
    if(viewTo >= CANDLES.length){ viewTo = CANDLES.length - 1; viewFrom = Math.max(0, viewTo - span); }
    applyView();
  }

  function tvReset(){
    if(!tvChart || !CANDLES.length) return;
    viewTo = CANDLES.length - 1;
    viewFrom = Math.max(0, viewTo - 70);
    applyView();
  }

  async function loadChart(){
    if(!curFut) return;
    $('gex-chart-title').textContent = curFut + ' · ' + curIv + ' · TRADINGVIEW CHART';
    ensureTradingViewChart();
    if(!tvSeries) return;
    try{
      var d = await getJson('/api/gex/candles/' + encodeURIComponent(curFut) + '?interval=' + encodeURIComponent(curIv) + '&t=' + Date.now());
      CANDLES = (d.candles || []).map(function(c){ return { time:c.time, open:c.open, high:c.high, low:c.low, close:c.close }; });
      viewFrom = 0; viewTo = 0;
      drawChart();
    }catch(e){
      $('gex-chart').innerHTML = '<div class="gex-chart-fallback">chart: '+esc(e.message)+'</div>';
    }
  }

  function drawChart(){
    ensureTradingViewChart();
    if(!tvSeries || !CANDLES.length) return;
    tvReset();
  }

  function renderPriceLines(){
    if(!tvSeries) return;
    tvPriceLines.forEach(function(line){ try{ tvSeries.removePriceLine(line); }catch(e){} });
    tvPriceLines = [];
    collectLines().forEach(function(l){
      tvPriceLines.push(tvSeries.createPriceLine({
        price: l.price,
        color: l.color,
        lineWidth: l.width || 2,
        lineStyle: l.dash ? LightweightCharts.LineStyle.Dashed : LightweightCharts.LineStyle.Solid,
        axisLabelVisible: true,
        title: l.title
      }));
    });
  }

  function updateChartRangeLabel(){
    var host = $('gex-chart');
    if(!host || !tvChart || !CANDLES.length) return;
    ensureView();
    var visible = Math.max(1, viewTo - viewFrom + 1);
    host.dataset.visibleBars = String(visible);
    host.dataset.totalBars = String(CANDLES.length);
    host.dataset.viewFrom = String(viewFrom);
    host.dataset.viewTo = String(viewTo);
    var label = $('gex-chart-range');
    if(label) label.textContent = visible + ' / ' + CANDLES.length + ' bars · TradingView pan/zoom/pinch';
  }

  function label(ctx, text, x, y, color){ /* legacy no-op: kept for old callers */ }


  function collectLines(){
    if(!DATA || !curFut) return [];
    var F = DATA.futures && DATA.futures[curFut];
    if(!F || F.error) return [];
    var L = F.levels || {}, out = [];
    function add(price,color,title,dashed,width){
      if(price != null) out.push({price:price,color:color,title:title,dash:dashed,width:width});
    }
    add(L.call_wall,'#ef4444','CALL WALL',false,2);
    add(L.zero_gamma,'#f59e0b','ZERO GAMMA',true,2);
    add(L.put_wall,'#22c55e','PUT WALL',false,2);
    add(L.iv68_hi,'#8b7cf6','IV +68%',true,1);
    add(L.iv68_lo,'#8b7cf6','IV -68%',true,1);
    if(showMkt){
      var S=(DATA.session||{})[curFut];
      if(S && !S.error){
        add(S.prior_vah,'#38bdf8','pVAH',true,1);
        add(S.prior_poc,'#38bdf8','pPOC',false,1);
        add(S.prior_val,'#38bdf8','pVAL',true,1);
        add(S.overnight_high,'#64748b','ONH',true,1);
        add(S.overnight_low,'#64748b','ONL',true,1);
      }
    }
    return out;
  }

  document.addEventListener('DOMContentLoaded', function(){ wireTabs(); loadLevels(); setInterval(loadLevels, 60000); setInterval(loadChart, 60000); });
})();
