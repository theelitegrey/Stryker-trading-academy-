// Stryker Trading Academy — native GEX dashboard
// Depends on: Cloudflare Pages Functions under /api/gex/* and a canvas element.
(function(){
  var MKTS = ['SPX', 'SPY', 'QQQ', 'GLD'];
  var MARKET_LABELS = { SPX:'SPX · ES/MES', SPY:'SPY · ES/MES', QQQ:'QQQ · NQ/MNQ', GLD:'GLD · GC/MGC' };
  var DTES = [{v:0,l:'0DTE'}, {v:1,l:'1DTE'}, {v:7,l:'1W'}, {v:30,l:'1M'}];
  var IVS = ['1m', '5m', '15m', '1h'];
  var cur = 'SPX', curDte = 1, curIv = '5m', curFut = null, DATA = null, CANDLES = [];
  var viewFrom = 0, viewTo = 0;
  var showMkt = true;
  // Plan limit (set by assets/plan-limits.js for Free members): which markets
  // and expiry views may load, and whether the strike table shows. null = full.
  // Client-side only: /api/gex/* itself is public.
  var LIMIT = null;
  function gexAllowed(m, d){ return !LIMIT || (LIMIT.markets.indexOf(m) >= 0 && LIMIT.dtes.indexOf(d) >= 0); }
  function gexUpgrade(why){
    if(typeof window.openPlanUpgradeModal === 'function') window.openPlanUpgradeModal(why);
  }
  var tvChart = null, tvSeries = null, tvPriceLines = [], tvBarSpacing = 7;
  // Locked price range {min,max}. Set by the fit on load / Reset / timeframe
  // change, then kept while the member pans or zooms in time, so the price
  // axis stays put and candles only slide left/right.
  var priceLock = null, chartKey = '';

  function $(id){ return document.getElementById(id); }
  function esc(s){ return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
  function fmt(n,d){ if(n == null || !isFinite(n)) return '—'; return Number(n).toLocaleString(undefined,{minimumFractionDigits:d == null ? 2 : d, maximumFractionDigits:d == null ? 2 : d}); }
  function bfmt(n){ if(n == null || !isFinite(n)) return '—'; return (n/1e9).toFixed(2) + 'B'; }
  function money(n){ if(n == null || !isFinite(n)) return '—'; return '$' + Math.abs(n).toLocaleString(undefined,{maximumFractionDigits:0}); }
  function cls(on){ return on ? ' is-on' : ''; }
  function mlabel(m){ return MARKET_LABELS[m] || m; }
  // "18m old" -> "18 min ago" for the "updated ..." status lines
  function agoText(label){ return String(label || 'unknown age').replace(/(\d+)m old$/, '$1 min ago').replace(/ old$/, ' ago'); }
  function ageLabel(ms){
    if(ms == null || !isFinite(ms)) return 'unknown age';
    var mins = Math.max(0, Math.round(ms / 60000));
    if(mins < 60) return mins + 'm old';
    var hrs = Math.floor(mins / 60), rem = mins % 60;
    if(hrs < 48) return hrs + 'h' + (rem ? ' ' + rem + 'm' : '') + ' old';
    var days = Math.floor(hrs / 24);
    return days + 'd ' + (hrs % 24) + 'h old';
  }
  function dataFreshness(asof){
    var t = asof ? Date.parse(asof) : NaN;
    if(!isFinite(t)) return {state:'stale', age:'unknown age', title:'Session data unavailable', reason:'No Cboe timestamp was returned for this options session.'};
    var age = Date.now() - t;
    var state = age <= 30*60000 ? 'fresh' : 'stale';
    if(state === 'fresh') return {state:state, age:ageLabel(age), title:'Market session active', reason:'Options chain updated '+agoText(ageLabel(age))+'.'};
    return {state:state, age:ageLabel(age), title:'Market closed', reason:'Options chain is frozen from the last Cboe session · '+ageLabel(age)+'.'};
  }
  // ---- Market status: closed-market disclaimer + chart tag (display only) ----
  // The API sends d.market = {state, futures_ts, options_ts, ...}; state is computed server-side
  // from the data timestamps and the CME/Cboe session calendar, not from the viewer's clock.
  function tsLocal(sec){
    if(!sec) return '';
    var dt = new Date(sec * 1000);
    var local = dt.toLocaleString(undefined, {weekday:'short', day:'numeric', month:'short', year:'numeric', hour:'numeric', minute:'2-digit', timeZoneName:'short'});
    var etz = dt.toLocaleString('en-US', {timeZone:'America/New_York', weekday:'short', hour:'numeric', minute:'2-digit'});
    return local + ' (' + etz + ' ET)';
  }
  // Session date is the exchange (New York) trading date, so a Friday session never reads as Saturday.
  function tsDay(sec){
    if(!sec) return '—';
    return new Date(sec * 1000).toLocaleDateString(undefined, {timeZone:'America/New_York', weekday:'short', day:'numeric', month:'short', year:'numeric'}) + ' (ET)';
  }
  function marketInfo(d){
    var m = d && d.market;
    if(!m || !m.state) return null;
    var futAge = m.futures_age_min != null ? ageLabel(m.futures_age_min * 60000) : null;
    var optAge = m.options_age_min != null ? ageLabel(m.options_age_min * 60000) : null;
    if(m.state === 'open') return {state:'fresh', title:'Market session active', reason:'Options chain updated '+agoText(optAge)+'.'};
    if(m.state === 'stale') return {state:'stale', title:'Waiting for the next update', reason:'Options chain updated '+agoText(optAge)+' · futures '+agoText(futAge)+'.'};
    if(m.state === 'opening'){
      var prior = m.options_ts ? new Date(m.options_ts * 1000).toLocaleDateString('en-US', {timeZone:'America/New_York', weekday:'long'}) : 'the last session';
      return {state:'stale', closed:'opening', title:'Market just opened',
        reason:'Today\'s options levels appear in a few minutes · showing '+prior+'\'s close until then.',
        note:'Market just opened. Today\'s options levels appear in a few minutes. Showing '+prior+'\'s close until then.',
        tag:'Levels from: '+tsDay(m.options_ts)};
    }
    if(m.state === 'cash_closed') return {state:'stale', closed:'cash', title:'Cash session closed',
      reason:'Options levels are from the last Cboe session · '+(optAge || 'unknown age')+'.',
      note:'Cash market closed. GEX levels are built from the last options chain received at '+tsLocal(m.options_ts)+'. Futures candles keep updating with the overnight session. Levels are not recent.',
      tag:'Levels from: '+tsDay(m.options_ts)};
    if(m.state === 'nodata') return {state:'stale', closed:'nodata', title:'No data available',
      reason:'No futures or options data was returned.',
      note:'No market data is available right now. Nothing is shown rather than an old or made-up chart.', tag:''};
    var at = m.data_ts || m.futures_ts || m.options_ts;
    return {state:'stale', closed:'market', title:'Market closed',
      reason:'Showing the last received data · '+tsLocal(at)+' · not live or recent.',
      note:'Market closed. Showing the last received data from '+tsLocal(at)+'. This is not live or recent.',
      tag:'Last session: '+tsDay(at)};
  }
  function dataFreshnessLegacy(asof){
    var t = asof ? Date.parse(asof) : NaN;
    if(!isFinite(t)) return {state:'stale', title:'Session data unavailable', reason:'No Cboe timestamp was returned for this options session.'};
    var age = Date.now() - t;
    if(age <= 30*60000) return {state:'fresh', title:'Market session active', reason:'Options chain updated '+agoText(ageLabel(age))+'.'};
    return {state:'stale', title:'Data not recent', reason:'Options chain is from the last Cboe session · '+ageLabel(age)+'.'};
  }
  function setFreshnessStatus(d){
    var f = marketInfo(d) || dataFreshnessLegacy(d && d.asof);
    var status = document.querySelector('.gex-status');
    if(status){
      status.classList.remove('is-fresh','is-stale');
      status.classList.add(f.state === 'fresh' ? 'is-fresh' : 'is-stale');
      status.setAttribute('data-freshness', f.state);
      status.setAttribute('data-market', (d && d.market && d.market.state) || 'unknown');
    }
    var txt = $('gex-freshness-text');
    if(txt) txt.innerHTML = '<b>'+esc(f.title)+'</b><span>'+esc(f.reason)+'</span>';
    var badge = document.querySelector('.gex-freshness');
    if(badge) badge.setAttribute('title', f.reason);
    var note = $('gex-closed-note');
    if(note){
      if(f.note){ note.hidden = false; note.setAttribute('data-kind', f.closed); note.innerHTML = '<b>'+esc(f.title)+'</b><span>'+esc(f.note)+'</span>'; }
      else { note.hidden = true; note.innerHTML = ''; }
    }
    var tag = $('gex-chart-tag');
    if(tag){
      if(f.tag){ tag.hidden = false; tag.textContent = f.tag; }
      else { tag.hidden = true; tag.textContent = ''; }
    }
  }

  function wireTabs(){
    $('gex-tabs').innerHTML = MKTS.map(function(m){ return '<button class="gex-tab'+cls(m === cur)+'" data-m="'+m+'"><span>'+m+'</span><small>'+esc((MARKET_LABELS[m] || m).split(' · ')[1] || '')+'</small></button>'; }).join('');
    $('gex-dtes').innerHTML = DTES.map(function(d){ return '<button class="gex-dte'+cls(d.v === curDte)+'" data-d="'+d.v+'">'+d.l+'</button>'; }).join('');
    $('gex-ivs').innerHTML = IVS.map(function(i){ return '<button class="gex-iv'+cls(i === curIv)+'" data-i="'+i+'">'+i+'</button>'; }).join('');
    $('gex-tabs').addEventListener('click', function(e){ var btn=e.target.closest('[data-m]'); var m=btn && btn.dataset.m; if(!m || m===cur) return; if(LIMIT && LIMIT.markets.indexOf(m) < 0){ gexUpgrade('Pro unlocks GEX for every symbol and expiry. The Free plan covers SPX, 0DTE.'); return; } cur=m; curFut=null; resetChartData('Loading '+mlabel(m)+'…'); paintButtons(); loadLevels(); });
    $('gex-dtes').addEventListener('click', function(e){ var btn=e.target.closest('[data-d]'); var d=btn && btn.dataset.d; if(d == null) return; if(LIMIT && LIMIT.dtes.indexOf(Number(d)) < 0){ gexUpgrade('Pro unlocks every expiry view. The Free plan covers SPX, 0DTE.'); return; } curDte=Number(d); resetChartData('Refreshing '+mlabel(cur)+'…'); paintButtons(); loadLevels(); });
    $('gex-ivs').addEventListener('click', function(e){ var btn=e.target.closest('[data-i]'); var i=btn && btn.dataset.i; if(!i) return; curIv=i; paintButtons(); resetChartData('Loading '+curFut+' '+i+'…'); loadChart(); });
    $('gex-futs').addEventListener('click', function(e){ var btn=e.target.closest('[data-f]'); var f=btn && btn.dataset.f; if(!f || !DATA || f===curFut) return; curFut=f; resetChartData('Loading '+f+'…'); render(DATA); loadChart(); });
    $('gex-toggle-market').addEventListener('click', function(){ showMkt = !showMkt; $('gex-toggle-market').textContent = 'Market levels: ' + (showMkt ? 'ON' : 'OFF'); drawChart(); });
    function bindZoom(id, fn){ var b=$(id); if(b){ b.onclick = fn; } }
    bindZoom('gex-zoom-in', function(e){ if(e) e.preventDefault(); tvZoom(0.72); });
    bindZoom('gex-zoom-out', function(e){ if(e) e.preventDefault(); tvZoom(1.38); });
    bindZoom('gex-zoom-reset', function(e){ if(e) e.preventDefault(); tvReset(); });
    window.addEventListener('resize', function(){ if(tvChart) tvChart.resize($('gex-chart').clientWidth, $('gex-chart').clientHeight); }, {passive:true});
  }

  function paintButtons(){
    document.querySelectorAll('.gex-tab').forEach(function(b){ b.classList.toggle('is-on', b.dataset.m === cur); b.classList.toggle('is-locked', !!LIMIT && LIMIT.markets.indexOf(b.dataset.m) < 0); });
    document.querySelectorAll('.gex-dte').forEach(function(b){ b.classList.toggle('is-on', Number(b.dataset.d) === curDte); b.classList.toggle('is-locked', !!LIMIT && LIMIT.dtes.indexOf(Number(b.dataset.d)) < 0); });
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
    $('gex-status-text').innerHTML = '<b>Loading '+esc(mlabel(cur))+'…</b><span> Building gamma walls, futures conversion and market-generated levels on strykertrading.com.</span>';
    var status = document.querySelector('.gex-status'); if(status){ status.classList.remove('is-fresh','is-stale'); }
    try{
      var d = await getJson('/api/gex/levels/' + encodeURIComponent(cur) + '?dte=' + curDte + '&t=' + Date.now());
      DATA = d;
      var futs = Object.keys(d.futures || {}).filter(function(k){ return !(d.futures[k] || {}).error; });
      if(!curFut || futs.indexOf(curFut) === -1) curFut = futs[0] || null;
      render(d);
      if(curFut) loadChart();
      else resetChartData('No futures data available');
    }catch(e){
      $('gex-status-text').innerHTML = '<b class="gex-error">GEX API error</b><span> '+esc(e.message)+'</span>';
      var status = document.querySelector('.gex-status'); if(status){ status.classList.remove('is-fresh'); status.classList.add('is-stale'); }
      var freshText = $('gex-freshness-text'); if(freshText) freshText.innerHTML = '<b>Session unavailable</b><span>GEX API did not return session timestamp data.</span>';
      $('gex-levels').innerHTML = '<p class="gex-error">'+esc(e.message)+'</p>';
    }
  }

  function render(d){
    var pos = d.regime === 'POSITIVE';
    var dteLabel = (DTES.find(function(x){return x.v===curDte;}) || {}).l || (curDte + 'DTE');
    var futs = Object.keys(d.futures || {}).filter(function(k){ return !(d.futures[k] || {}).error; });
    var F = curFut ? d.futures[curFut] : null;
    setFreshnessStatus(d);
    $('gex-status-text').innerHTML = '<b>'+esc(d.underlying)+' → '+esc(futs.join(' / ') || d.fut)+'</b><span> '+esc(String(d.contracts))+' contracts · '+esc(dteLabel)+(d.expiry?' · exp '+esc(d.expiry):'')+' · Cboe '+esc(d.asof || '')+'</span>';
    $('gex-futs').innerHTML = futs.length ? futs.map(function(f){ var sub = ({ES:'S&P futures',MES:'Micro ES',NQ:'Nasdaq futures',MNQ:'Micro NQ',GC:'Gold futures',MGC:'Micro gold'})[f] || 'Futures'; return '<button class="gex-fut'+cls(f === curFut)+'" data-f="'+f+'"><span>'+f+'</span><small>'+sub+'</small></button>'; }).join('') : '<span class="gex-empty">'+(d.market && d.market.state === 'nodata' ? 'No futures data available' : 'Futures data unavailable')+'</span>';
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
      ? '<b>Positive gamma regime.</b> Under the model\'s assumption that dealers are long the calls and short the puts, dealers are estimated to be long gamma here. In that state their hedging tends to lean against moves, which the model reads as mean reversion and pinning between the major walls. A move below zero gamma marks where the model\'s regime would flip. Education only. Not financial advice.'
      : '<b>Negative gamma regime.</b> Under the model\'s assumption that dealers are long the calls and short the puts, dealers are estimated to be short gamma here. In that state their hedging tends to move with price, which the model reads as larger, more directional swings through levels. A move back above zero gamma marks where the model\'s regime would flip. Education only. Not financial advice.';
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
    if(LIMIT && LIMIT.noLadder){
      $('gex-ladder').innerHTML = '<div class="plan-lock-card"><b>Strike table is part of Pro</b><p>Pro shows net GEX, DEX and open interest strike by strike, for every symbol and expiry.</p><button type="button" class="btn btn-primary btn-sm" data-open-plan-modal data-upgrade-reason="Pro unlocks the full GEX strike table for every symbol and expiry.">See Pro</button></div>';
      return;
    }
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



  function ensureTradingViewChart(){
    var host = $('gex-chart');
    if(!host || tvChart) return;
    if(!window.LightweightCharts){ host.innerHTML = '<div class="gex-chart-fallback">TradingView chart library failed to load.</div>'; return; }
    tvChart = LightweightCharts.createChart(host, {
      autoSize: true,
      layout: { background: { color: '#050608' }, textColor: '#8b949e', fontFamily: 'ui-monospace,SFMono-Regular,Menlo,monospace' },
      grid: { vertLines: { color: 'rgba(255,255,255,.045)' }, horzLines: { color: 'rgba(255,255,255,.055)' } },
      rightPriceScale: { borderColor: 'rgba(255,255,255,.10)', scaleMargins: { top: .12, bottom: .15 }, autoScale: true },
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
      upColor: '#03c988', downColor: '#e5484d', borderUpColor: '#03c988', borderDownColor: '#e5484d', wickUpColor: '#03c988', wickDownColor: '#e5484d',
      // The series only holds the visible slice (applyView), so the built-in
      // last-value label would follow the last VISIBLE bar while panning back.
      // renderPriceLines() draws the current-price line from the full CANDLES.
      lastValueVisible: false, priceLineVisible: false,
      autoscaleInfoProvider: function(orig){
        if(!priceLock) return orig();
        var r = orig() || {};
        return { priceRange: { minValue: priceLock.min, maxValue: priceLock.max }, margins: r.margins };
      }
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
    var slice = CANDLES.slice(viewFrom, viewTo + 1);
    if(!priceLock) priceLock = fitPriceRange(slice);
    else keepCurrentPriceInLock();
    tvSeries.setData(slice);
    renderPriceLines();
    tvChart.timeScale().fitContent();
    updateChartRangeLabel();
  }

  // Fit used at rest: the visible candles, the current price and the key
  // levels that sit near it (walls only when close).
  function fitPriceRange(slice){
    var lo = Infinity, hi = -Infinity;
    slice.forEach(function(c){ if(c.low < lo) lo = c.low; if(c.high > hi) hi = c.high; });
    var last = CANDLES[CANDLES.length - 1];
    if(last && isFinite(last.close)){ lo = Math.min(lo, last.close); hi = Math.max(hi, last.close); }
    if(!isFinite(lo) || !isFinite(hi)) return null;
    var ref = last ? last.close : (lo + hi) / 2;
    var band = Math.max(hi - lo, Math.abs(ref) * 0.002);
    collectLines().forEach(function(l){
      if(l.price == null || !isFinite(l.price)) return;
      if(Math.abs(l.price - ref) <= band){ lo = Math.min(lo, l.price); hi = Math.max(hi, l.price); }
    });
    if(hi - lo < 1e-9){ lo -= 1; hi += 1; }
    return { min: lo, max: hi };
  }

  // The latest price must always be inside the locked range.
  function keepCurrentPriceInLock(){
    var last = CANDLES[CANDLES.length - 1];
    if(!priceLock || !last || !isFinite(last.close)) return;
    if(last.close < priceLock.min) priceLock.min = last.close;
    if(last.close > priceLock.max) priceLock.max = last.close;
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
    priceLock = null;
    try{ tvChart.priceScale('right').applyOptions({ autoScale: true }); }catch(e){}
    applyView();
  }

  function resetChartData(msg){
    CANDLES = [];
    priceLock = null;
    chartKey = '';
    viewFrom = 0;
    viewTo = 0;
    var host = $('gex-chart');
    if(host){
      host.dataset.visibleBars = '0';
      host.dataset.totalBars = '0';
      host.dataset.viewFrom = '0';
      host.dataset.viewTo = '0';
    }
    if(tvSeries){
      tvPriceLines.forEach(function(line){ try{ tvSeries.removePriceLine(line); }catch(e){} });
      tvPriceLines = [];
      try{ tvSeries.setData([]); }catch(e){}
      try{ tvChart.priceScale('right').applyOptions({ autoScale: true }); }catch(e){}
    }
    var label = $('gex-chart-range');
    if(label) label.textContent = msg || 'Loading chart…';
  }

  async function loadChart(){
    if(!curFut) return;
    $('gex-chart-title').textContent = cur + ' → ' + curFut + ' · ' + curIv + ' · TRADINGVIEW CHART';
    ensureTradingViewChart();
    if(!tvSeries) return;
    try{
      var d = await getJson('/api/gex/candles/' + encodeURIComponent(curFut) + '?interval=' + encodeURIComponent(curIv) + '&t=' + Date.now());
      var key = curFut + '|' + curIv;
      var oldLen = CANDLES.length, hadView = oldLen && viewTo > viewFrom && key === chartKey;
      var fromEnd = hadView ? (oldLen - 1 - viewTo) : 0, span = hadView ? (viewTo - viewFrom) : 0;
      CANDLES = (d.candles || []).map(function(c){ return { time:c.time, open:c.open, high:c.high, low:c.low, close:c.close }; });
      chartKey = key;
      if(hadView && CANDLES.length){
        // 60 s refresh of the same chart: keep the member's place in time
        // and the locked price range instead of snapping back.
        viewTo = Math.max(0, CANDLES.length - 1 - fromEnd);
        viewFrom = Math.max(0, viewTo - span);
        applyView();
      } else {
        viewFrom = 0; viewTo = 0;
        drawChart();
      }
    }catch(e){
      resetChartData('Chart unavailable');
      $('gex-chart').insertAdjacentHTML('beforeend', '<div class="gex-chart-fallback">chart: '+esc(e.message)+'</div>');
    }
  }

  function drawChart(){
    ensureTradingViewChart();
    if(!tvSeries || !CANDLES.length) return;
    // Levels refresh or market-levels toggle: keep the current view.
    if(viewTo > viewFrom && viewTo < CANDLES.length){ applyView(); return; }
    tvReset();
  }

  function renderPriceLines(){
    if(!tvSeries) return;
    tvPriceLines.forEach(function(line){ try{ tvSeries.removePriceLine(line); }catch(e){} });
    tvPriceLines = [];
    // Current price = latest candle close, whatever range is on screen.
    var last = CANDLES.length ? CANDLES[CANDLES.length - 1] : null;
    if(last && isFinite(last.close)){
      tvPriceLines.push(tvSeries.createPriceLine({
        price: last.close,
        color: last.close >= last.open ? '#03c988' : '#e5484d',
        lineWidth: 1,
        lineStyle: LightweightCharts.LineStyle.Dotted,
        axisLabelVisible: true,
        title: ''
      }));
    }
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

  // Called by assets/plan-limits.js once the member's plan is known.
  window.strykerGexSetLimit = function(l){
    LIMIT = l || null;
    var reload = !gexAllowed(cur, curDte);
    if(reload){ cur = LIMIT.markets[0]; curDte = LIMIT.dtes[0]; curFut = null; resetChartData('Loading '+mlabel(cur)+'…'); }
    paintButtons();
    if(reload) loadLevels(); else if(DATA) render(DATA);
  };

  document.addEventListener('DOMContentLoaded', function(){ wireTabs(); loadLevels(); setInterval(loadLevels, 60000); setInterval(loadChart, 60000); });
})();
