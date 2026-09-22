// Every gated page must lay out at the phone's own width. A page that forces
// the document wider is scaled down by the browser to fit, which is why a
// single unbreakable string can shrink an entire screen's type.
// (paths come from ./lib.js)
const { chromium, ROOT, BASE, launch } = require('./lib.js');
const stub = require('./richstub.js'); const fs=require('fs');
const TRACKERS = process.env.STRYKER_TRACKERS_DIR ? process.env.STRYKER_TRACKERS_DIR.replace(/\/?$/, '/') : null;
const PAGES=['dashboard-user.html','market-brief.html','market-map.html','economic-calendar.html',
  'global-monitor.html','smart-money.html','courses.html','chapter.html?ch=01','trade-journal.html',
  'backtests.html','models.html','model.html?id=ict-2022-model','indicators.html',
  'indicator.html?id=fvg-relay','live-sessions.html','trading-floor.html','achievements.html',
  'profile.html','settings.html','referrals.html'];
(async()=>{
  const b=await launch();
  const ctx=await b.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true});
  await ctx.addInitScript(stub);
  await ctx.addInitScript(()=>{try{localStorage.setItem('stryker_install_prompt_shown_u1','1');localStorage.setItem('stryker_push_prompt_shown_u1','1');}catch(e){}});
  await ctx.route(/^https?:\/\/(?!localhost)/, r=>r.abort());
  await ctx.route(/market-trackers-data/, r=>{
    const m=r.request().url().match(/market-trackers-data(?:@main)?\/(?:main\/)?(.+?)(?:\?.*)?$/);
    const f=m&&TRACKERS&&TRACKERS+m[1];
    if(f&&/\.gz$/.test(f)){r.fulfill({status:404,body:'x'});return;}
    if(f&&fs.existsSync(f)) r.fulfill({status:200,contentType:'application/json',body:fs.readFileSync(f)});
    else r.fulfill({status:404,body:'x'});
  });
  await ctx.route(/monitor-data\.json/, r=>{
    try{const d=JSON.parse(fs.readFileSync(__dirname + '/fixtures/monitor-live.json','utf8'));d.generatedAt=Date.now();
      r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(d)});}catch(e){r.abort();}
  });
  let bad=0;
  for (const u of PAGES) {
    const p=await ctx.newPage();
    try{
      await p.goto(BASE + '/'+u,{waitUntil:'domcontentloaded',timeout:20000});
      await p.waitForTimeout(3000);
      const r=await p.evaluate(()=>({layout:innerWidth, doc:document.documentElement.scrollWidth,
        vw:document.documentElement.clientWidth}));
      const ok = r.layout<=390 && r.doc<=392;
      if(!ok) bad++;
      console.log((ok?'PASS  ':'FAIL  ')+u.padEnd(32)+'layout '+String(r.layout).padStart(4)+'  docScroll '+String(r.doc).padStart(4));
    }catch(e){ bad++; console.log('ERROR '+u+'  '+e.message.split('\n')[0].slice(0,60)); }
    await p.close();
  }
  await b.close();
  console.log('\n'+(PAGES.length-bad)+'/'+PAGES.length+' pages lay out at phone width');
  process.exit(bad?1:0);
})();
