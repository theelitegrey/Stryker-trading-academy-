// Models v2 test rig. usage: node mv2.mjs <baseUrl> <outdir> [scenario...]
// Firebase CDN is replaced by a chainable stub: signed-in user "u-test",
// every Firestore read empty (so models fall back to MODELS_SEED), no writes.
import { chromium } from 'playwright-core';
import fs from 'fs';
const outdir = null;

const EXE = '/root/.cache/ms-playwright/chromium-1217/chrome-linux64/chrome';

export const STUB = `
(function(){
  function snap(){ return { exists:false, empty:true, size:0, docs:[], forEach(){}, data(){ return {}; }, docChanges(){ return []; } }; }
  function chain(){
    const f = function(){ return p; };
    const p = new Proxy(f, { get(t, k){
      if (k === 'then') return undefined;
      if (k === 'get') return () => Promise.resolve(snap());
      if (k === 'onSnapshot') return (cb) => { try { typeof cb === 'function' ? cb(snap()) : (cb && cb.next && cb.next(snap())); } catch(e){} return () => {}; };
      if (k === 'set' || k === 'update' || k === 'add' || k === 'delete') return () => Promise.resolve();
      return p;
    }, apply(){ return p; } });
    return p;
  }
  const user = { uid:'u-test', email:'test@example.com', emailVerified:true, displayName:'Test', getIdToken:()=>Promise.resolve('x'), reload:()=>Promise.resolve() };
  const authObj = new Proxy({ currentUser:user,
    onAuthStateChanged(cb){ setTimeout(()=>cb(user), 30); return ()=>{}; },
    onIdTokenChanged(cb){ setTimeout(()=>cb(user), 30); return ()=>{}; },
    setPersistence(){ return Promise.resolve(); }, signOut(){ return Promise.resolve(); } },
    { get(t,k){ return k in t ? t[k] : (()=>Promise.resolve()); } });
  const fsObj = chain();
  const firebase = new Proxy({
    apps:[{}], initializeApp(){ return {}; }, app(){ return {}; },
    auth: Object.assign(()=>authObj, { Auth:{ Persistence:{ LOCAL:'local', SESSION:'session' } }, GoogleAuthProvider:function(){} }),
    firestore: Object.assign(()=>fsObj, { FieldValue:{ serverTimestamp(){return 0;}, increment(){return 0;}, arrayUnion(){return 0;}, arrayRemove(){return 0;}, delete(){return 0;} }, Timestamp:{ now(){ return { toMillis(){ return Date.now(); } }; }, fromMillis(){ return {}; } } }),
    functions: ()=>chain(), messaging: Object.assign(()=>chain(), { isSupported(){ return false; } }), storage: ()=>chain(),
  }, { get(t,k){ return k in t ? t[k] : chain(); } });
  window.firebase = firebase;
})();`;

export async function openPage(browser, url, { w = 390, h = 844, theme = 'night', reduced = false, mobile = null } = {}) {
  const isMobile = mobile === null ? w < 700 : mobile;
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true,
    viewport: { width: w, height: h }, deviceScaleFactor: isMobile ? 2 : 1, isMobile, hasTouch: isMobile,
    userAgent: isMobile ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' : undefined,
    reducedMotion: reduced ? 'reduce' : 'no-preference',
  });
  await ctx.addInitScript((t) => {
    try {
      localStorage.setItem('stryker_theme', t);
      localStorage.setItem('stryker_install_prompt_shown_u-test', '1');
      localStorage.setItem('stryker_tour_done', '1');
    } catch (e) {}
  }, theme === 'day' ? 'day' : 'night');
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (r) => {
    const u = r.request().url();
    if (/gstatic\.com\/firebasejs\/.*firebase-app-compat/.test(u)) return r.fulfill({ status: 200, contentType: 'application/javascript', body: STUB });
    if (/gstatic\.com\/firebasejs/.test(u)) return r.fulfill({ status: 200, contentType: 'application/javascript', body: '/* stub */' });
    return r.abort();
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + String(e.message).slice(0, 200)));
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForTimeout(600);
  return { ctx, page, errors };
}

export async function launch() {
  return chromium.launch({ executablePath: EXE, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
}
