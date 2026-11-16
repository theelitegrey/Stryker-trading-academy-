// IFVG Pro+ risk/reward box must be the same when the chart streams live as when it is added fresh.
// Bug (member GK, 16 Nov): on a live chart the box sat off the entry and did not follow new bars until the
// indicator was re-added. Cause: the per-timeframe aggregation (f_run) and setup resolution ran on every tick
// of the forming bar, so the same higher-timeframe candle was pushed again and again.
// Needs a local pinets 0.11.0:  PINETS=/path/to/node_modules/pinets node tools/tests/ifvg-rr-live.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const PINETS = process.env.PINETS;
if (!PINETS) { console.log('SKIP: set PINETS=<path to node_modules/pinets>'); process.exit(0); }
const pt = await import(pathToFileURL(path.join(PINETS, 'dist', 'pinets.min.es.js')).href);
const patches = await import(pathToFileURL(path.join(here, '..', '..', 'assets', 'chart-pine-next-patches.js')).href);
function mk(seed,N){let x=seed,p=100; const rnd=()=>{x=(x*16807)%2147483647;return x/2147483647};
const bars=[];let dir=1,leg=0;
for(let i=0;i<N;i++){ if(leg--<=0){dir=rnd()<.5?1:-1;leg=8+Math.floor(rnd()*20);} const o=p; p+=dir*(0.5+rnd()*2.5)+(rnd()-.5)*.4; const c=Math.round(p*4)/4;
 bars.push({openTime:1.7e12+i*6e4,closeTime:1.7e12+(i+1)*6e4,open:o,high:Math.max(o,c)+rnd()*.5,low:Math.min(o,c)-rnd()*.5,close:c,volume:100});}return bars;}
let src = fs.readFileSync(process.env.PINE_SRC || path.join(here, '..', '..', 'assets', 'pine', 'ifvg-pro-stryker.pine'), 'utf8').replace(/\r/g, '');
// make setups easy to trigger on random-walk bars; the logic under test is untouched
src = src.replace('minGapT * syminfo.mintick', '0.0').replace('hideFail  = input.bool(true', 'hideFail  = input.bool(false').replace('minLeg   = input.float(1.0', 'minLeg   = input.float(0.0')
  .replace('input.string("Wick through, close back inside", "Sweep definition"', 'input.string("Either", "Sweep definition"').replace('input.int(5, "Setups kept', 'input.int(50, "Setups kept');
src = patches.rewriteSource(src);
const SEED=1, TOT=2300, START=2100;
const all=mk(SEED,TOT);
const T0=Date.now(); let clock=T0+1e7;           // virtual now
all.forEach((b,i)=>{b.openTime=T0+i*6e4;b.closeTime=T0+(i+1)*6e4;});
const realNow=Date.now; Date.now=()=>clock;
let n=START, partial=false;
function view(){ const cur=all.slice(0,n).map(b=>({...b})); if(partial){ const l=cur[cur.length-1]; l.close=(l.open+l.close)/2; l.high=Math.max(l.open,l.close); l.low=Math.min(l.open,l.close);} return cur; }
let lastKey='', calls=0, served=0;
const provider={getMarketData:async(s,tf,limit,sDate)=>{ calls++; const cur=view(); const h=sDate==null?cur:cur.filter(b=>b.openTime>=sDate); const d=h[h.length-1]; const k=h.length+'|'+(d&&d.openTime)+'|'+(d&&d.close); if(sDate!=null&&k===lastKey) return []; lastKey=k; if(sDate!=null) served++; return h;},
 getSymbolInfo:async()=>({ticker:'X',tickerid:'X',mintick:.25,pointvalue:1,timezone:'UTC',session:'regular',type:'futures',currency:'USD',pricescale:4,minmove:1})};
clock=all[START-1].closeTime+1;  // history all closed
const p=new pt.PineTS(provider,'X','1',START);
await p.ready();
const ev=p.stream(src,{live:true,interval:30,pageSize:START});
let last=null, tick=null; ev.on('data',ctx=>{last=ctx; if(tick) tick();}); ev.on('error',e=>console.log('ERR',e));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
await sleep(1500);
for(let i=START;i<TOT;i++){
  n=i+1; partial=true; clock=all[i].openTime+30000; await sleep(100);   // forming bar tick
  partial=false; clock=all[i].closeTime+1; await sleep(100);             // bar closes (final values)
}
await sleep(300);
ev.stop(); clock=all[n-1].closeTime+1;
const lb=last.plots.__boxes__.data[0].value;
const ref=await new pt.PineTS(all.slice(0,n),'X','1').run(src);
const rb=ref.plots.__boxes__.data[0].value;
const key=b=>[b.left,b.right,b.top.toFixed(2),b.bottom.toFixed(2),b.bgcolor].join(',');
const A=new Set(lb.map(key)),B=new Set(rb.map(key));
const onlyLive=[...A].filter(x=>!B.has(x)), onlyStatic=[...B].filter(x=>!A.has(x));
const ll=l=>l.filter(x=>/IFVG/.test(x.text)).map(x=>x.x+x.text[0]).join(' ');
const labLive=ll(last.plots.__labels__.data[0].value), labStatic=ll(ref.plots.__labels__.data[0].value);
if (process.env.DUMP) fs.writeFileSync(process.env.DUMP, JSON.stringify({ bars: all.slice(2000, n), live: lb, fresh: rb }));
let fails=0; const check=(ok,m)=>{console.log((ok?'PASS ':'FAIL ')+m); if(!ok) fails++;};
check(rb.length>20,'fixture makes setups ('+rb.length+' boxes on a fresh run)');
check(lb.length===rb.length,'live run draws as many boxes as a fresh run ('+lb.length+' vs '+rb.length+')');
check(onlyLive.length===0&&onlyStatic.length===0,'every risk / reward box has the same price and bars live and fresh'+(onlyLive.length||onlyStatic.length?' (live-only '+onlyLive.length+', fresh-only '+onlyStatic.length+')':''));
check(labLive===labStatic,'IFVG labels sit on the same bars live and fresh');
if(process.env.DBG){console.log(onlyLive,onlyStatic,labLive,'|',labStatic);}
process.exit(fails?1:0);
